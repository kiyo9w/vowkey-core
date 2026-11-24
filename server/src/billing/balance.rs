use chrono::Utc;
use diesel::prelude::*;
use serde::Serialize;
use crate::{api::ApiResult, db::{DbConn, DbConnInner, schema::decision_balances}, Error};

#[derive(Clone, Debug, Queryable, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Balance {
    pub allowance_day: String,
    pub used_today: i32,
    pub allowance_month: String,
    pub used_this_month: i32,
    pub credit_units: i64,
}
fn ensure(owner: &str, day: &str, month: &str, conn: &mut DbConnInner) -> Result<(), diesel::result::Error> {
    macro_rules! initialize { ($c:expr, $target:expr) => {
        diesel::insert_into(decision_balances::table).values((
            decision_balances::owner_uuid.eq(owner), decision_balances::allowance_day.eq(day),
            decision_balances::used_today.eq(0), decision_balances::allowance_month.eq(month),
            decision_balances::used_this_month.eq(0), decision_balances::credit_units.eq(0_i64),
            decision_balances::updated_at.eq(Utc::now().naive_utc()),
        )).on_conflict($target).do_nothing().execute($c)
    }; }
    match conn {
        #[cfg(mysql)] DbConnInner::Mysql(c) => initialize!(c, diesel::dsl::DuplicatedKeys),
        #[cfg(postgresql)] DbConnInner::Postgresql(c) => initialize!(c, decision_balances::owner_uuid),
        #[cfg(sqlite)] DbConnInner::Sqlite(c) => initialize!(c, decision_balances::owner_uuid),
    }?;
    Ok(())
}
pub fn credit_on(owner: &str, units: i64, conn: &mut DbConnInner) -> ApiResult<()> {
    if units < 1 { err!("Invalid credit quantity") }
    let now = Utc::now();
    ensure(owner, &now.format("%Y-%m-%d").to_string(), &now.format("%Y-%m").to_string(), conn)?;
    let changed = diesel::update(decision_balances::table.filter(decision_balances::owner_uuid.eq(owner))
        .filter(decision_balances::credit_units.le(i64::MAX - units)))
        .set((decision_balances::credit_units.eq(decision_balances::credit_units + units), decision_balances::updated_at.eq(Utc::now().naive_utc())))
        .execute(conn)?;
    if changed != 1 { err!("Credit balance overflow") }
    Ok(())
}
fn read_on(owner: &str, day: &str, month: &str, conn: &mut DbConnInner) -> Result<Balance, diesel::result::Error> {
    let row = decision_balances::table.filter(decision_balances::owner_uuid.eq(owner))
        .select((decision_balances::allowance_day, decision_balances::used_today,
                 decision_balances::allowance_month, decision_balances::used_this_month,
                 decision_balances::credit_units))
        .first::<Balance>(conn).optional()?;
    Ok(match row {
        Some(mut row) => {
            // Each bucket resets on its own clock only. Credits are never reset.
            if row.allowance_day != day { row.used_today = 0; row.allowance_day = day.to_owned(); }
            if row.allowance_month != month { row.used_this_month = 0; row.allowance_month = month.to_owned(); }
            row
        }
        None => Balance { allowance_day: day.to_owned(), used_today: 0,
            allowance_month: month.to_owned(), used_this_month: 0, credit_units: 0 },
    })
}
pub async fn read(owner: &str, conn: &DbConn) -> ApiResult<Balance> {
    let now = Utc::now();
    let day = now.format("%Y-%m-%d").to_string();
    let month = now.format("%Y-%m").to_string();
    conn.run(move |c| Ok(read_on(owner, &day, &month, c)?)).await
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Consumption { pub allowed: bool, pub remaining: i64, pub credit_units: i64, #[serde(skip)] pub notify_low: bool }
fn consume_on(owner: &str, allowance_day: i32, allowance_month: i32, day: &str, month: &str, conn: &mut DbConnInner) -> ApiResult<Consumption> {
    // Every bucket spend is one conditional UPDATE, so each successful request
    // takes exactly one unit and the last unit can be taken only once, even when
    // requests arrive at the same time. Order: daily base, monthly Hosted
    // Agent, then purchased credits.
    conn.transaction::<_, Error, _>(|c| {
        ensure(owner, day, month, c)?;
        diesel::update(decision_balances::table.filter(decision_balances::owner_uuid.eq(owner)))
            .set(decision_balances::updated_at.eq(Utc::now().naive_utc())).execute(c)?;
        diesel::update(decision_balances::table.filter(decision_balances::owner_uuid.eq(owner))
            .filter(decision_balances::allowance_day.ne(day)))
            .set((decision_balances::allowance_day.eq(day), decision_balances::used_today.eq(0))).execute(c)?;
        diesel::update(decision_balances::table.filter(decision_balances::owner_uuid.eq(owner))
            .filter(decision_balances::allowance_month.ne(month)))
            .set((decision_balances::allowance_month.eq(month), decision_balances::used_this_month.eq(0))).execute(c)?;
        let daily = diesel::update(decision_balances::table.filter(decision_balances::owner_uuid.eq(owner))
            .filter(decision_balances::used_today.lt(allowance_day)))
            .set(decision_balances::used_today.eq(decision_balances::used_today + 1)).execute(c)?;
        let monthly = if daily == 0 {
            diesel::update(decision_balances::table.filter(decision_balances::owner_uuid.eq(owner))
                .filter(decision_balances::used_this_month.lt(allowance_month)))
                .set(decision_balances::used_this_month.eq(decision_balances::used_this_month + 1)).execute(c)?
        } else { 0 };
        let paid = if daily == 0 && monthly == 0 {
            let rows = diesel::update(decision_balances::table.filter(decision_balances::owner_uuid.eq(owner))
                .filter(decision_balances::credit_units.gt(0)))
                .set(decision_balances::credit_units.eq(decision_balances::credit_units - 1)).execute(c)?;
            if rows != 1 { return Err(Error::new_msg("Decision allowance exhausted").with_code(429)); }
            rows
        } else { 0 };
        let row = read_on(owner, day, month, c)?;
        let remaining = i64::from((allowance_day - row.used_today).max(0))
            .saturating_add(i64::from((allowance_month - row.used_this_month).max(0)))
            .saturating_add(row.credit_units);
        Ok(Consumption { allowed: true, remaining, credit_units: row.credit_units,
            notify_low: paid == 1 && allowance_month > 0 && row.credit_units == i64::from(allowance_month) - 1 })
    })
}
pub async fn consume(owner: &str, allowance_day: i32, allowance_month: i32, conn: &DbConn) -> ApiResult<Consumption> {
    let now = Utc::now();
    let day = now.format("%Y-%m-%d").to_string();
    let month = now.format("%Y-%m").to_string();
    conn.run(move |c| consume_on(owner, allowance_day, allowance_month, &day, &month, c)).await
}

#[cfg(all(test, sqlite))]
mod tests {
    use super::*;
    use diesel::{connection::SimpleConnection, sqlite::SqliteConnection};
    fn database() -> DbConnInner {
        let mut c = SqliteConnection::establish(":memory:").unwrap();
        c.batch_execute("CREATE TABLE decision_balances(owner_uuid TEXT PRIMARY KEY,allowance_day TEXT NOT NULL,used_today INTEGER NOT NULL DEFAULT 0,allowance_month TEXT NOT NULL DEFAULT '',used_this_month INTEGER NOT NULL DEFAULT 0,credit_units BIGINT NOT NULL DEFAULT 0,updated_at TIMESTAMP NOT NULL)").unwrap();
        DbConnInner::Sqlite(c)
    }
    fn stored(c: &mut DbConnInner) -> Balance {
        match c {
            DbConnInner::Sqlite(c) => decision_balances::table
                .select((decision_balances::allowance_day, decision_balances::used_today,
                         decision_balances::allowance_month, decision_balances::used_this_month,
                         decision_balances::credit_units))
                .first::<Balance>(c).unwrap(),
            #[cfg(not(sqlite))] _ => unreachable!(),
        }
    }
    #[test]
    fn allowance_then_credits_are_atomic_and_reset_on_new_utc_day() {
        let mut c = database();
        assert_eq!(consume_on("user", 1, 0, "2026-11-04", "2026-11", &mut c).unwrap().remaining, 0);
        assert_eq!(consume_on("user", 1, 0, "2026-11-04", "2026-11", &mut c).unwrap_err().message(), "Decision allowance exhausted");
        credit_on("user", 2, &mut c).unwrap();
        assert_eq!(consume_on("user", 1, 0, "2026-11-04", "2026-11", &mut c).unwrap().credit_units, 1);
        assert_eq!(consume_on("user", 1, 0, "2026-11-05", "2026-11", &mut c).unwrap().credit_units, 1);
        assert_eq!(consume_on("user", 1, 0, "2026-11-05", "2026-11", &mut c).unwrap().credit_units, 0);
        assert!(consume_on("user", 1, 0, "2026-11-05", "2026-11", &mut c).is_err());
    }
    #[test]
    fn low_credit_notification_is_monthly_and_only_crosses_once_per_purchase() {
        let mut c = database();
        credit_on("user", 3, &mut c).unwrap();
        // First two requests use the two-unit monthly allowance, then credits.
        assert_eq!(consume_on("user", 0, 2, "2026-11-04", "2026-11", &mut c).unwrap().notify_low, false);
        assert_eq!(consume_on("user", 0, 2, "2026-11-04", "2026-11", &mut c).unwrap().notify_low, false);
        assert_eq!(consume_on("user", 0, 2, "2026-11-04", "2026-11", &mut c).unwrap().notify_low, false);
        assert_eq!(consume_on("user", 0, 2, "2026-11-04", "2026-11", &mut c).unwrap().notify_low, true);
        assert_eq!(stored(&mut c).credit_units, 1);

        credit_on("user", 3, &mut c).unwrap();
        assert_eq!(consume_on("user", 0, 2, "2026-11-04", "2026-11", &mut c).unwrap().notify_low, false);
        assert_eq!(consume_on("user", 0, 2, "2026-11-04", "2026-11", &mut c).unwrap().notify_low, false);
        assert_eq!(consume_on("user", 0, 2, "2026-11-04", "2026-11", &mut c).unwrap().notify_low, true);
    }
    #[test]
    fn daily_bucket_refills_within_the_month_and_leaves_the_rest() {
        let mut c = database();
        credit_on("user", 1, &mut c).unwrap();
        // Two daily requests, then the first request spends the monthly bucket.
        consume_on("user", 2, 3, "2026-11-04", "2026-11", &mut c).unwrap();
        consume_on("user", 2, 3, "2026-11-04", "2026-11", &mut c).unwrap();
        consume_on("user", 2, 3, "2026-11-04", "2026-11", &mut c).unwrap();
        let row = stored(&mut c);
        assert_eq!((row.used_today, row.used_this_month, row.credit_units), (2, 1, 1));
        // A new UTC day refills only the daily bucket; the monthly usage and
        // the purchased credit are untouched.
        consume_on("user", 2, 3, "2026-11-05", "2026-11", &mut c).unwrap();
        let row = stored(&mut c);
        assert_eq!((row.allowance_day.as_str(), row.used_today, row.used_this_month, row.credit_units), ("2026-11-05", 1, 1, 1));
    }
    #[test]
    fn month_rollover_refills_the_monthly_bucket_without_spending_credits() {
        let mut c = database();
        credit_on("user", 2, &mut c).unwrap();
        // Daily (2) and monthly (1) are spent out; the next request spends a credit.
        consume_on("user", 2, 1, "2026-11-04", "2026-11", &mut c).unwrap();
        consume_on("user", 2, 1, "2026-11-04", "2026-11", &mut c).unwrap();
        consume_on("user", 2, 1, "2026-11-04", "2026-11", &mut c).unwrap();
        let paid = consume_on("user", 2, 1, "2026-11-04", "2026-11", &mut c).unwrap();
        assert_eq!(paid.credit_units, 1);
        assert_eq!((stored(&mut c).used_this_month, stored(&mut c).credit_units), (1, 1));
        // A new UTC month resets used_this_month only. The rollover itself does
        // not spend a credit, and the request spends the refilled daily bucket.
        let next = consume_on("user", 2, 1, "2026-12-04", "2026-12", &mut c).unwrap();
        let row = stored(&mut c);
        assert_eq!((row.allowance_month.as_str(), row.used_this_month, row.credit_units), ("2026-12", 0, 1));
        assert_eq!((next.remaining, row.used_today), (3, 1));
        assert_eq!((row.used_today, row.credit_units), (1, 1));
    }
    #[test]
    fn every_request_takes_exactly_one_unit_until_the_whole_allowance_is_spent() {
        let mut c = database();
        credit_on("user", 1, &mut c).unwrap();
        // 2 daily + 1 monthly + 1 credit = 4 requests, then the 429.
        for remaining in [3, 2, 1, 0] {
            let spent = consume_on("user", 2, 1, "2026-11-04", "2026-11", &mut c).unwrap();
            assert_eq!(spent.remaining, remaining);
        }
        assert_eq!(consume_on("user", 2, 1, "2026-11-04", "2026-11", &mut c).unwrap_err().message(), "Decision allowance exhausted");
        let row = stored(&mut c);
        assert_eq!((row.used_today, row.used_this_month, row.credit_units), (2, 1, 0));
    }
    #[test]
    fn concurrent_requests_cannot_overspend_the_same_unit() {
        let path = std::env::temp_dir().join(format!("vowkey-balance-{}.sqlite3", uuid::Uuid::new_v4()));
        let url = path.to_str().unwrap();
        let mut setup = SqliteConnection::establish(url).unwrap();
        setup.batch_execute("CREATE TABLE decision_balances(owner_uuid TEXT PRIMARY KEY,allowance_day TEXT NOT NULL,used_today INTEGER NOT NULL DEFAULT 0,allowance_month TEXT NOT NULL DEFAULT '',used_this_month INTEGER NOT NULL DEFAULT 0,credit_units BIGINT NOT NULL DEFAULT 0,updated_at TIMESTAMP NOT NULL)").unwrap();
        let mut first = SqliteConnection::establish(url).unwrap();
        let mut second = SqliteConnection::establish(url).unwrap();
        first.batch_execute("PRAGMA busy_timeout = 5000;").unwrap();
        second.batch_execute("PRAGMA busy_timeout = 5000;").unwrap();
        let barrier = std::sync::Arc::new(std::sync::Barrier::new(2));
        let run = |barrier: std::sync::Arc<std::sync::Barrier>, conn: SqliteConnection| {
            std::thread::spawn(move || {
                barrier.wait();
                let mut conn = DbConnInner::Sqlite(conn);
                consume_on("user", 1, 0, "2026-11-04", "2026-11", &mut conn)
            })
        };
        let first_handle = run(barrier.clone(), first);
        let second_handle = run(barrier, second);
        let results = [first_handle.join().unwrap(), second_handle.join().unwrap()];
        assert_eq!(results.iter().filter(|result| result.is_ok()).count(), 1);
        assert_eq!(results.iter().filter(|result| result.is_err()).count(), 1);
        assert_eq!(results.into_iter().find_map(Result::err).unwrap().message(), "Decision allowance exhausted");
        let mut check = DbConnInner::Sqlite(SqliteConnection::establish(url).unwrap());
        assert_eq!(stored(&mut check).used_today, 1);
        drop(check);
        drop(setup);
        std::fs::remove_file(path).unwrap();
    }
}
