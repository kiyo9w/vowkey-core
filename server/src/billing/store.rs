use chrono::Utc;
use diesel::prelude::*;
use crate::{api::ApiResult, db::{DbConn, DbConnInner, models::Subscription, schema::{billing_events, subscriptions, users, organizations}}, Error};
use super::{balance, provider::{BillingEvent, Owner, PlanCode}};

#[derive(Default)]
pub struct Applied { pub owner: Option<Owner>, pub seats: Option<i32>, pub credits_added: bool, pub payment_failed: bool }
fn insert_event(provider: &str, event_id: &str, conn: &mut DbConnInner) -> ApiResult<bool> {
    macro_rules! insert { ($c:expr, $target:expr) => {
        diesel::insert_into(billing_events::table).values((billing_events::provider.eq(provider),
            billing_events::event_id.eq(event_id), billing_events::received_at.eq(Utc::now().naive_utc())))
            .on_conflict($target).do_nothing().execute($c)
    }; }
    let changed = match conn {
        #[cfg(mysql)] DbConnInner::Mysql(c) => insert!(c, diesel::dsl::DuplicatedKeys),
        #[cfg(postgresql)] DbConnInner::Postgresql(c) => insert!(c, (billing_events::provider, billing_events::event_id)),
        #[cfg(sqlite)] DbConnInner::Sqlite(c) => insert!(c, (billing_events::provider, billing_events::event_id)),
    }?;
    Ok(changed == 1)
}
pub fn apply_on(provider: &str, event_id: &str, event: Option<BillingEvent>, conn: &mut DbConnInner) -> ApiResult<Applied> {
    conn.transaction::<_, Error, _>(|c| {
        if !insert_event(provider, event_id, c)? { return Ok(Applied::default()); }
        let Some(event) = event else { return Ok(Applied::default()) };
        let owner = match &event { BillingEvent::SubscriptionChanged {owner, ..} | BillingEvent::CreditsPurchased {owner, ..} | BillingEvent::PaymentFailed {owner} => owner };
        let exists: bool = match owner {
            Owner::User(id) => {
                diesel::update(users::table.filter(users::uuid.eq(id))).set(users::updated_at.eq(users::updated_at)).execute(c)?;
                diesel::select(diesel::dsl::exists(users::table.filter(users::uuid.eq(id)).select(users::uuid))).get_result(c)?
            },
            Owner::Organization(id) => {
                diesel::update(organizations::table.filter(organizations::uuid.eq(id))).set(organizations::name.eq(organizations::name)).execute(c)?;
                diesel::select(diesel::dsl::exists(organizations::table.filter(organizations::uuid.eq(id)).select(organizations::uuid))).get_result(c)?
            },
        };
        if !exists { err!("Payment owner does not exist"); }
        let mut applied = Applied { owner: Some(owner.clone()), ..Applied::default() };
        match event {
            BillingEvent::SubscriptionChanged { owner, provider_subscription_id, provider_customer_id, plan_code, quantity, status, current_period_end, occurred_at, campaign } => {
                let previous = subscriptions::table.filter(subscriptions::provider.eq(provider))
                    .filter(subscriptions::provider_subscription_id.eq(&provider_subscription_id)).first::<Subscription>(c).optional()?;
                if let Some(row) = &previous {
                    if row.user_uuid.as_ref() != match &owner { Owner::User(id) => Some(id), _ => None }
                        || row.org_uuid.as_ref() != match &owner { Owner::Organization(id) => Some(id), _ => None } { err!("Payment subscription owner cannot change"); }
                    if row.updated_at >= occurred_at { return Ok(Applied::default()); }
                }
                let mut row = Subscription::new(owner, plan_code, quantity);
                if let Some(previous) = &previous { row.uuid.clone_from(&previous.uuid); }
                row.provider = Some(provider.into()); row.provider_customer_id = Some(provider_customer_id);
                row.provider_subscription_id = Some(provider_subscription_id); row.status = status.as_str().into();
                row.current_period_end = (current_period_end > 0).then_some(current_period_end); row.updated_at = occurred_at;
                if row.kind == "base" {
                    let candidates = match (&row.user_uuid, &row.org_uuid) {
                        (Some(user), _) => subscriptions::table.filter(subscriptions::user_uuid.eq(user)).load::<Subscription>(c)?,
                        (_, Some(org)) => subscriptions::table.filter(subscriptions::org_uuid.eq(org)).load::<Subscription>(c)?,
                        _ => unreachable!(),
                    };
                    if candidates.iter().any(|other| other.kind == "base" && other.plan_code != "free" && other.uuid != row.uuid && other.updated_at > occurred_at) {
                        return Ok(Applied::default());
                    }
                    if row.is_entitled() {
                        for mut other in candidates.into_iter().filter(|other| other.kind == "base" && other.uuid != row.uuid && other.is_entitled()) {
                            other.status = "canceled".into(); other.updated_at = occurred_at; other.save_on(c)?;
                        }
                    }
                }
                if plan_code == PlanCode::Office && row.is_entitled() && previous.as_ref().is_none_or(|prior| prior.quantity != quantity) { applied.seats = Some(quantity); }
                row.save_on(c)?;
                if previous.as_ref().is_none_or(|prior| prior.plan_code != row.plan_code || prior.quantity != row.quantity || prior.status != row.status) {
                    diesel::update(billing_events::table.filter(billing_events::provider.eq(provider)).filter(billing_events::event_id.eq(event_id)))
                        .set((billing_events::plan_code.eq(Some(plan_code.as_str())), billing_events::campaign.eq(Some(crate::db::models::campaign_slug(campaign))))).execute(c)?;
                }
            },
            BillingEvent::CreditsPurchased { owner, units } => { balance::credit_on(owner.id(), units, c)?; applied.credits_added = true; },
            BillingEvent::PaymentFailed { .. } => { applied.payment_failed = true; },
        }
        Ok(applied)
    })
}
pub async fn apply(provider: &str, event_id: &str, event: Option<BillingEvent>, conn: &DbConn) -> ApiResult<Applied> {
    conn.run(move |c| apply_on(provider, event_id, event, c)).await
}

#[cfg(all(test, sqlite))]
mod tests {
    use super::*;
    use crate::billing::provider::Status;
    use diesel::{connection::SimpleConnection, sqlite::SqliteConnection};

    fn database() -> DbConnInner {
        let mut conn = SqliteConnection::establish(":memory:").unwrap();
        conn.batch_execute("CREATE TABLE users(uuid TEXT PRIMARY KEY, updated_at TIMESTAMP NOT NULL);
            CREATE TABLE organizations(uuid TEXT PRIMARY KEY, name TEXT NOT NULL);
            CREATE TABLE subscriptions(uuid TEXT PRIMARY KEY, user_uuid TEXT, org_uuid TEXT, plan_code TEXT NOT NULL,
                kind TEXT NOT NULL, quantity INTEGER NOT NULL, status TEXT NOT NULL, provider TEXT, provider_customer_id TEXT,
                provider_subscription_id TEXT, current_period_end BIGINT, updated_at TIMESTAMP NOT NULL);
            CREATE TABLE billing_events(provider TEXT NOT NULL, event_id TEXT NOT NULL, received_at TIMESTAMP NOT NULL,
                plan_code TEXT, campaign TEXT, PRIMARY KEY(provider, event_id));
            INSERT INTO users(uuid, updated_at) VALUES ('user', '2026-11-04');").unwrap();
        DbConnInner::Sqlite(conn)
    }

    fn subscription(second: i64, quantity: i32) -> Option<BillingEvent> {
        Some(BillingEvent::SubscriptionChanged { owner: Owner::User("user".into()), provider_subscription_id: "sub_fixture".into(),
            provider_customer_id: "ctm_fixture".into(), plan_code: PlanCode::Family, quantity, status: Status::Active,
            current_period_end: second + 100, occurred_at: chrono::DateTime::from_timestamp(second, 0).unwrap().naive_utc(), campaign: "launch" })
    }

    #[test]
    fn plan_change_metadata_counts_only_accepted_changes_not_replays_or_renewals() {
        let mut conn = database();
        apply_on("paddle", "evt_first", subscription(1000, 1), &mut conn).unwrap();
        assert!(apply_on("paddle", "evt_first", subscription(1000, 1), &mut conn).unwrap().owner.is_none());
        assert!(apply_on("paddle", "evt_stale", subscription(999, 3), &mut conn).unwrap().owner.is_none());
        apply_on("paddle", "evt_renewal", subscription(1001, 1), &mut conn).unwrap();
        apply_on("paddle", "evt_seats", subscription(1002, 2), &mut conn).unwrap();
        let rows = billing_events::table.order(billing_events::event_id)
            .select((billing_events::event_id, billing_events::plan_code, billing_events::campaign))
            .load::<(String, Option<String>, Option<String>)>(&mut conn).unwrap();
        assert_eq!(rows.len(), 4);
        assert_eq!(rows.iter().filter(|row| row.1.is_some()).count(), 2);
        for (event, plan, campaign) in rows {
            if matches!(event.as_str(), "evt_first" | "evt_seats") {
                assert_eq!(plan.as_deref(), Some("family"));
                assert_eq!(campaign.as_deref(), Some("launch"));
            } else {
                assert!(plan.is_none());
                assert!(campaign.is_none());
            }
        }
        let row = subscriptions::table.first::<Subscription>(&mut conn).unwrap();
        assert_eq!(row.quantity, 2);
    }

    #[test]
    fn accepted_plan_change_drops_an_unknown_campaign() {
        let mut conn = database();
        let mut event = subscription(1000, 1);
        if let Some(BillingEvent::SubscriptionChanged { campaign, .. }) = &mut event {
            *campaign = "ada@example.test";
        }
        apply_on("paddle", "evt_unknown_campaign", event, &mut conn).unwrap();
        let (plan, campaign) = billing_events::table.select((billing_events::plan_code, billing_events::campaign))
            .first::<(Option<String>, Option<String>)>(&mut conn).unwrap();
        assert_eq!(plan.as_deref(), Some("family"));
        assert_eq!(campaign.as_deref(), Some(""));
    }
}
