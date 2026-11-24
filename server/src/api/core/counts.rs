use chrono::{NaiveDate, NaiveDateTime, NaiveTime, Utc};
use diesel::prelude::*;
use rocket::{Route, serde::json::Json};
use serde_json::Value;

use crate::{
    api::EmptyResult,
    auth::ClientIp,
    db::{
        DbConn, DbPool,
        models::{CountEvent, DeviceType, ServerCount, TelemetryDaily, visible_counts},
        schema::{billing_events, ciphers, devices, users},
    },
};

pub fn routes() -> Vec<Route> {
    routes![post_counts]
}

#[post("/counts", data = "<body>")]
async fn post_counts(body: Json<Value>, ip: ClientIp, conn: DbConn) -> EmptyResult {
    crate::ratelimit::check_limit_unauthenticated(&ip.ip)?;
    // An unknown field or value is dropped whole. The address is used for the limit and not stored.
    if let Some(event) = CountEvent::parse(&body) {
        TelemetryDaily::record(event, &conn).await?;
    }
    Ok(())
}

/// Cells under five are omitted. The admin route passes rows it already loaded.
pub fn admin_counts(rows: &[TelemetryDaily]) -> Value {
    json!({ "counts": visible_counts(rows) })
}

/// Daily totals from rows the server already has, for the UTC day before today.
pub async fn aggregate_daily_counts(pool: DbPool) {
    let Ok(conn) = pool.get().await else {
        error!("Daily counts skipped: no database connection");
        return;
    };
    let day = Utc::now().date_naive().pred_opt().expect("a previous day");
    match write_server_day(day, &conn).await {
        Ok(()) => info!("Daily counts completed for {day}"),
        Err(error) => error!("Daily counts failed: {error}"),
    }
}

async fn write_server_day(day: NaiveDate, conn: &DbConn) -> EmptyResult {
    let (start, end) = day_bounds(day);
    let label = day.format("%Y-%m-%d").to_string();
    let counts = conn
        .run(move |conn| server_counts(start, end, conn))
        .await
        .map_err(|error: diesel::result::Error| ("Error reading daily counts", error))?;
    TelemetryDaily::replace_server_day(&label, &counts, conn).await
}

fn day_bounds(day: NaiveDate) -> (NaiveDateTime, NaiveDateTime) {
    let start = day.and_time(NaiveTime::MIN);
    (start, start + chrono::Duration::days(1))
}

fn server_counts(
    start: NaiveDateTime,
    end: NaiveDateTime,
    conn: &mut crate::db::DbConnInner,
) -> Result<Vec<ServerCount>, diesel::result::Error> {
    let mut counts = Vec::new();
    push(&mut counts, "accounts_created", "", users::table.filter(users::created_at.ge(start)).filter(users::created_at.lt(end)).count().get_result(conn)?);
    push(
        &mut counts,
        "guest_vaults_attached",
        "",
        users::table
            .filter(users::guest_attached_at.ge(start))
            .filter(users::guest_attached_at.lt(end))
            .count()
            .get_result(conn)?,
    );

    // First device of each type per account, not every device created that day.
    let prior = diesel::alias!(devices as prior_devices);
    for (kind, total) in devices::table
        .filter(devices::created_at.ge(start))
        .filter(devices::created_at.lt(end))
        .filter(diesel::dsl::not(diesel::dsl::exists(
            prior
                .filter(prior.field(devices::user_uuid).eq(devices::user_uuid))
                .filter(prior.field(devices::atype).eq(devices::atype))
                .filter(prior.field(devices::created_at).lt(start))
                .select(prior.field(devices::user_uuid)),
        )))
        .group_by(devices::atype)
        .select((devices::atype, diesel::dsl::count(devices::user_uuid).aggregate_distinct()))
        .load::<(i32, i64)>(conn)?
    {
        push(&mut counts, "first_device", &DeviceType::from_i32(kind).to_string(), total);
    }
    for (kind, total) in ciphers::table
        .filter(ciphers::created_at.ge(start))
        .filter(ciphers::created_at.lt(end))
        .group_by(ciphers::atype)
        .select((ciphers::atype, diesel::dsl::count_star()))
        .load::<(i32, i64)>(conn)?
    {
        push(&mut counts, "items", &cipher_kind(kind), total);
    }
    for (plan, campaign, total) in billing_events::table
        .filter(billing_events::received_at.ge(start))
        .filter(billing_events::received_at.lt(end))
        .filter(billing_events::plan_code.is_not_null())
        .group_by((billing_events::plan_code, billing_events::campaign))
        .select((billing_events::plan_code, billing_events::campaign, diesel::dsl::count_star()))
        .load::<(Option<String>, Option<String>, i64)>(conn)?
    {
        if let Some(plan) = plan {
            push(&mut counts, "plan_changes", &format!("{plan}:{}", campaign.as_deref().unwrap_or("")), total);
        }
    }
    // decision_* totals come from record_decision_usage and are not rebuilt here.
    Ok(counts)
}

fn push(counts: &mut Vec<ServerCount>, event: &'static str, page: &str, count: i64) {
    if count > 0 {
        counts.push(ServerCount { event, page: page.to_owned(), count });
    }
}

fn cipher_kind(kind: i32) -> String {
    match kind {
        1 => "login",
        2 => "note",
        3 => "card",
        4 => "profile",
        5 => "key",
        6 => "bank_account",
        7 => "drivers_license",
        _ => "other",
    }
    .to_owned()
}

#[cfg(all(test, sqlite))]
mod tests {
    use super::*;
    use crate::db::DbConnInner;
    use diesel::{connection::SimpleConnection, sqlite::SqliteConnection};

    fn database() -> SqliteConnection {
        let mut sqlite = SqliteConnection::establish(":memory:").unwrap();
        sqlite.batch_execute("CREATE TABLE users(uuid TEXT PRIMARY KEY, created_at TIMESTAMP NOT NULL, guest_attached_at TIMESTAMP);
            CREATE TABLE devices(user_uuid TEXT NOT NULL, atype INTEGER NOT NULL, created_at TIMESTAMP NOT NULL);
            CREATE TABLE ciphers(created_at TIMESTAMP NOT NULL, atype INTEGER NOT NULL);
            CREATE TABLE billing_events(provider TEXT NOT NULL, event_id TEXT NOT NULL, received_at TIMESTAMP NOT NULL, plan_code TEXT, campaign TEXT);").unwrap();
        sqlite
    }

    #[test]
    fn first_device_counts_each_account_once_when_it_first_uses_a_device_kind() {
        let mut sqlite = database();
        sqlite.batch_execute("INSERT INTO users VALUES
                ('older_account', '2026-11-01 00:00:00', NULL),
                ('new_account', '2026-11-04 12:00:00', NULL);
            INSERT INTO devices VALUES
                ('older_account', 0, '2026-11-03 23:59:59'),
                ('older_account', 0, '2026-11-04 12:00:00'),
                ('older_account', 1, '2026-11-04 00:00:00'),
                ('older_account', 1, '2026-11-04 23:59:59'),
                ('new_account', 1, '2026-11-04 12:00:00'),
                ('new_account', 1, '2026-11-04 13:00:00'),
                ('new_account', 2, '2026-11-05 00:00:00');").unwrap();
        let mut conn = DbConnInner::Sqlite(sqlite);
        let (start, end) = day_bounds(NaiveDate::from_ymd_opt(2026, 11, 4).unwrap());
        let rows = server_counts(start, end, &mut conn).unwrap().into_iter()
            .filter(|row| row.event == "first_device").map(|row| (row.page, row.count)).collect::<Vec<_>>();
        assert_eq!(rows, vec![(DeviceType::from_i32(1).to_string(), 2)]);
    }

    #[test]
    fn plan_change_cohorts_use_received_day_and_accepted_event_metadata() {
        let mut sqlite = database();
        sqlite.batch_execute("INSERT INTO billing_events VALUES
                ('paddle', 'evt_first', '2026-11-04 00:00:00', 'family', 'launch'),
                ('paddle', 'evt_second', '2026-11-04 23:59:59', 'family', 'launch'),
                ('paddle', 'evt_without_campaign', '2026-11-04 12:00:00', 'family', ''),
                ('paddle', 'evt_office', '2026-11-04 12:00:00', 'office', 'agent'),
                ('paddle', 'evt_stale', '2026-11-04 12:00:00', NULL, NULL),
                ('paddle', 'evt_prior_day', '2026-11-03 23:59:59', 'family', 'launch'),
                ('paddle', 'evt_next_day', '2026-11-05 00:00:00', 'family', 'launch');").unwrap();
        let mut conn = DbConnInner::Sqlite(sqlite);
        let (start, end) = day_bounds(NaiveDate::from_ymd_opt(2026, 11, 4).unwrap());
        let mut rows = server_counts(start, end, &mut conn).unwrap().into_iter()
            .filter(|row| row.event == "plan_changes").map(|row| (row.page, row.count)).collect::<Vec<_>>();
        rows.sort();
        assert_eq!(rows, vec![("family:".to_owned(), 1), ("family:launch".to_owned(), 2), ("office:agent".to_owned(), 1)]);
    }
}
