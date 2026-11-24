use chrono::{NaiveDateTime, Utc};
use diesel::prelude::*;
use crate::{api::{ApiResult, EmptyResult}, billing::{entitlement::{self, Entitlement}, provider::{Owner, PlanCode}}, db::{DbConn, DbConnInner, schema::{organizations, subscriptions, users}}, error::MapResult, util::get_uuid};
use super::{OrganizationId, UserId};

#[derive(Clone, Debug, Identifiable, Queryable, Insertable, AsChangeset)]
#[diesel(table_name = subscriptions, treat_none_as_null = true, primary_key(uuid))]
pub struct Subscription {
    pub uuid: String,
    pub user_uuid: Option<UserId>,
    pub org_uuid: Option<OrganizationId>,
    pub plan_code: String,
    pub kind: String,
    pub quantity: i32,
    pub status: String,
    pub provider: Option<String>,
    pub provider_customer_id: Option<String>,
    pub provider_subscription_id: Option<String>,
    pub current_period_end: Option<i64>,
    pub updated_at: NaiveDateTime,
}
impl Subscription {
    pub fn new(owner: Owner, plan: PlanCode, quantity: i32) -> Self {
        let (user_uuid, org_uuid) = match owner { Owner::User(id) => (Some(id), None), Owner::Organization(id) => (None, Some(id)) };
        Self { uuid: get_uuid(), user_uuid, org_uuid, plan_code: plan.as_str().into(), kind: plan.kind().into(), quantity,
            status: "active".into(), provider: None, provider_customer_id: None, provider_subscription_id: None,
            current_period_end: None, updated_at: Utc::now().naive_utc() }
    }
    pub fn is_entitled(&self) -> bool { matches!(self.status.as_str(), "active" | "trialing" | "past_due") }
    pub fn save_on(&self, conn: &mut DbConnInner) -> EmptyResult {
        if self.quantity < 1 || self.user_uuid.is_some() == self.org_uuid.is_some()
            || PlanCode::parse(&self.plan_code).is_none_or(|plan| plan.kind() != self.kind) {
            err!("Invalid subscription")
        }
        macro_rules! upsert { ($c:expr, $target:expr) => {
            diesel::insert_into(subscriptions::table).values(self).on_conflict($target).do_update().set(self).execute($c)
        }; }
        match conn {
            #[cfg(mysql)] DbConnInner::Mysql(c) => upsert!(c, diesel::dsl::DuplicatedKeys),
            #[cfg(postgresql)] DbConnInner::Postgresql(c) => upsert!(c, subscriptions::uuid),
            #[cfg(sqlite)] DbConnInner::Sqlite(c) => upsert!(c, subscriptions::uuid),
        }.map(|_| ()).map_res("Error saving subscription")?;
        Ok(())
    }
    pub async fn save(&mut self, conn: &DbConn) -> EmptyResult {
        self.updated_at = Utc::now().naive_utc();
        let row = self.clone(); conn.run(move |c| row.save_on(c)).await
    }
    pub async fn ensure_free(user: &UserId, conn: &DbConn) -> EmptyResult {
        let mut row = Self::new(Owner::User(user.clone()), PlanCode::Free, 1);
        row.uuid = user.to_string();
        conn.run(move |conn| {
            macro_rules! initialize { ($c:expr, $target:expr) => {
                diesel::insert_into(subscriptions::table).values(&row).on_conflict($target).do_nothing().execute($c)
            }; }
            match conn {
                #[cfg(mysql)] DbConnInner::Mysql(c) => initialize!(c, diesel::dsl::DuplicatedKeys),
                #[cfg(postgresql)] DbConnInner::Postgresql(c) => initialize!(c, subscriptions::uuid),
                #[cfg(sqlite)] DbConnInner::Sqlite(c) => initialize!(c, subscriptions::uuid),
            }.map(|_| ()).map_res("Error ensuring free subscription")?;
            Ok(())
        }).await
    }
    pub async fn all_for_user(user: &UserId, conn: &DbConn) -> ApiResult<Vec<Self>> {
        let user = user.clone();
        conn.run(move |c| subscriptions::table.filter(subscriptions::user_uuid.eq(user)).load(c).map_res("Error loading subscriptions")).await
    }
    pub async fn all_for_org(org: &OrganizationId, conn: &DbConn) -> ApiResult<Vec<Self>> {
        let org = org.clone();
        conn.run(move |c| subscriptions::table.filter(subscriptions::org_uuid.eq(org)).load(c).map_res("Error loading subscriptions")).await
    }
    pub fn grant_admin_on(owner: Owner, plan: PlanCode, quantity: i32, status: &str, c: &mut DbConnInner) -> ApiResult<Self> {
        if quantity < 1 || !matches!(status, "active" | "trialing") { err!("Invalid plan grant"); }
        if matches!(plan, PlanCode::Office) && !matches!(owner, Owner::Organization(_)) { err!("A Business plan belongs to an organization"); }
        c.transaction::<_, crate::Error, _>(|c| {
            match &owner {
                Owner::User(id) => diesel::update(users::table.filter(users::uuid.eq(id))).set(users::updated_at.eq(users::updated_at)).execute(c),
                Owner::Organization(id) => diesel::update(organizations::table.filter(organizations::uuid.eq(id))).set(organizations::name.eq(organizations::name)).execute(c),
            }.map(|_| ()).map_res("Plan owner does not exist")?;
            let rows = match &owner {
                Owner::User(id) => subscriptions::table.filter(subscriptions::user_uuid.eq(id)).load::<Subscription>(c),
                Owner::Organization(id) => subscriptions::table.filter(subscriptions::org_uuid.eq(id)).load::<Subscription>(c),
            }.map_res("Error loading subscriptions")?;
            let now = Utc::now().naive_utc();
            let mut row = Subscription::new(owner, plan, quantity);
            row.status = status.into();
            if plan.kind() == "base" {
                if let Some(existing) = rows.iter().find(|other| other.kind == "base" && other.provider.is_none() && other.plan_code != "free") {
                    row.uuid.clone_from(&existing.uuid);
                }
                for mut other in rows.into_iter().filter(|other| other.kind == "base" && other.provider.is_none() && other.uuid != row.uuid && other.is_entitled() && other.plan_code != row.plan_code) {
                    other.status = "canceled".into(); other.updated_at = now; other.save_on(c)?;
                }
            } else if let Some(existing) = rows.iter().find(|other| other.kind == "addon" && other.provider.is_none() && other.plan_code == row.plan_code) {
                row.uuid.clone_from(&existing.uuid);
            }
            row.updated_at = now;
            row.save_on(c)?;
            Ok(row)
        })
    }
    pub async fn grant_admin(owner: Owner, plan: PlanCode, quantity: i32, status: &str, conn: &DbConn) -> ApiResult<Self> {
        conn.run(move |c| Self::grant_admin_on(owner, plan, quantity, status, c)).await
    }
    pub async fn effective_for_user(user: &UserId, conn: &DbConn) -> ApiResult<Entitlement> { entitlement::for_user(user, conn).await }
    pub async fn delete_all_by_user(user: &UserId, conn: &DbConn) -> EmptyResult {
        let user = user.clone(); conn.run(move |c| diesel::delete(subscriptions::table.filter(subscriptions::user_uuid.eq(user))).execute(c).map(|_| ()).map_res("Error deleting subscriptions")).await
    }
    pub async fn delete_all_by_org(org: &OrganizationId, conn: &DbConn) -> EmptyResult {
        let org = org.clone(); conn.run(move |c| diesel::delete(subscriptions::table.filter(subscriptions::org_uuid.eq(org))).execute(c).map(|_| ()).map_res("Error deleting subscriptions")).await
    }
}
#[cfg(all(test, sqlite))]
mod tests {
    use super::*;
    use diesel::{connection::SimpleConnection, sqlite::SqliteConnection};
    fn database() -> DbConnInner {
        let mut c = SqliteConnection::establish(":memory:").unwrap();
        SimpleConnection::batch_execute(&mut c, "CREATE TABLE users(uuid TEXT PRIMARY KEY, updated_at TIMESTAMP NOT NULL); CREATE TABLE organizations(uuid TEXT PRIMARY KEY, name TEXT NOT NULL); CREATE TABLE subscriptions(uuid TEXT PRIMARY KEY, user_uuid TEXT, org_uuid TEXT, plan_code TEXT NOT NULL, kind TEXT NOT NULL, quantity INTEGER NOT NULL, status TEXT NOT NULL, provider TEXT, provider_customer_id TEXT, provider_subscription_id TEXT, current_period_end BIGINT, updated_at TIMESTAMP NOT NULL); INSERT INTO organizations(uuid, name) VALUES ('org', 'Office'); INSERT INTO users(uuid, updated_at) VALUES ('user', '2026-11-04')").unwrap();
        DbConnInner::Sqlite(c)
    }
    #[test]
    fn admin_grant_replaces_one_base_and_keeps_paid_rows() {
        let mut c = database();
        let org = Owner::Organization("org".into());
        let mut paid = Subscription::new(org.clone(), PlanCode::Family, 1);
        paid.provider = Some("paddle".into()); paid.provider_subscription_id = Some("sub".into()); paid.save_on(&mut c).unwrap();
        let storage = Subscription::new(org.clone(), PlanCode::StoragePlus, 2); storage.save_on(&mut c).unwrap();
        Subscription::grant_admin_on(org.clone(), PlanCode::Office, 4, "trialing", &mut c).unwrap();
        Subscription::grant_admin_on(org.clone(), PlanCode::Office, 7, "trialing", &mut c).unwrap();
        let rows = match &mut c { DbConnInner::Sqlite(c) => subscriptions::table.filter(subscriptions::org_uuid.eq("org")).load::<Subscription>(c).unwrap(), #[cfg(not(sqlite))] _ => unreachable!() };
        let office: Vec<_> = rows.iter().filter(|row| row.plan_code == "office" && row.is_entitled()).collect();
        assert_eq!(office.len(), 1); assert_eq!(office[0].quantity, 7); assert!(office[0].provider.is_none());
        assert!(rows.iter().any(|row| row.provider.as_deref() == Some("paddle") && row.is_entitled()));
        assert!(rows.iter().any(|row| row.plan_code == "storage_plus" && row.quantity == 2 && row.is_entitled()));
        assert!(Subscription::grant_admin_on(Owner::User("user".into()), PlanCode::Office, 1, "trialing", &mut c).is_err());
    }
}
