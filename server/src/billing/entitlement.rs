use serde::Serialize;
use crate::{api::ApiResult, db::{DbConn, models::{OrganizationId, Subscription, UserId}}, CONFIG};
use super::provider::PlanCode;

pub const DEFAULT_FREE_STORAGE_KB: i64 = 1_048_576;
pub const FREE_RELAY_DAILY_LIMIT: i32 = 300;
/// Hosted Agent add-on: 3,000 requests per month per pack. The numbers in code are the
/// starter defaults; pricing is an owner choice and stays out of the server code.
pub const HOSTED_AGENT_MONTHLY_PER_PACK: i32 = 3000;
#[derive(Clone, Copy, Debug)]
pub struct PlanSpec {
    pub storage_kb: i64,
    pub seats: i32,
    pub decision_per_day: i32,
    pub decision_per_month: i32,
}
impl PlanSpec {
    pub fn for_code(code: PlanCode) -> Self {
        // The base plan carries only the daily allowance. The Hosted Agent
        // add-on carries the monthly allowance; it never adds to the daily one.
        let (storage_kb, seats, decision_per_day, decision_per_month) = match code {
            PlanCode::Free => (DEFAULT_FREE_STORAGE_KB, 1, FREE_RELAY_DAILY_LIMIT, 0),
            PlanCode::Family => (10 * DEFAULT_FREE_STORAGE_KB, 6, 1000, 0),
            PlanCode::Office => (50 * DEFAULT_FREE_STORAGE_KB, 1, 5000, 0),
            PlanCode::StoragePlus => (25 * DEFAULT_FREE_STORAGE_KB, 0, 0, 0),
            PlanCode::HostedAgent => (0, 0, 0, HOSTED_AGENT_MONTHLY_PER_PACK),
        };
        Self { storage_kb, seats, decision_per_day, decision_per_month }
    }
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Entitlement {
    pub base_plan: PlanCode,
    pub storage_kb: i64,
    pub seats: i32,
    pub decision_per_day: i32,
    pub decision_per_month: i32,
    pub hosted_agent: bool,
    pub has_paid_base: bool,
}
impl Entitlement {
    pub fn effective_plan_code(&self) -> &'static str { self.base_plan.as_str() }
    pub fn from_rows(rows: &[Subscription]) -> Self {
        let base = rows.iter().filter(|row| row.kind == "base" && row.is_entitled())
            .filter_map(|row| PlanCode::parse(&row.plan_code).filter(|plan| plan.kind() == "base").map(|plan| (row, plan)))
            .max_by_key(|(row, plan)| (*plan != PlanCode::Free, row.updated_at, &row.uuid));
        let (base_plan, quantity) = base.map_or((PlanCode::Free, 1), |(row, plan)| (plan, row.quantity));
        let spec = PlanSpec::for_code(base_plan);
        let mut result = Self { base_plan, storage_kb: spec.storage_kb,
            seats: if base_plan == PlanCode::Office { quantity } else { spec.seats },
            decision_per_day: spec.decision_per_day, decision_per_month: spec.decision_per_month,
            hosted_agent: false,
            has_paid_base: rows.iter().any(|row| row.kind == "base" && row.plan_code != "free"
                && row.provider.is_some() && row.is_entitled()) };
        for row in rows.iter().filter(|row| row.kind == "addon" && row.is_entitled()) {
            let Some(plan) = PlanCode::parse(&row.plan_code).filter(|plan| plan.kind() == "addon") else { continue };
            let spec = PlanSpec::for_code(plan);
            result.storage_kb = result.storage_kb.saturating_add(spec.storage_kb.saturating_mul(i64::from(row.quantity)));
            result.decision_per_day = result.decision_per_day.saturating_add(spec.decision_per_day.saturating_mul(row.quantity));
            result.decision_per_month = result.decision_per_month.saturating_add(spec.decision_per_month.saturating_mul(row.quantity));
            result.hosted_agent |= plan == PlanCode::HostedAgent;
        }
        result
    }
}
pub async fn for_user(user: &UserId, conn: &DbConn) -> ApiResult<Entitlement> {
    Subscription::ensure_free(user, conn).await?;
    let mut entitlement = Entitlement::from_rows(&Subscription::all_for_user(user, conn).await?);
    if entitlement.base_plan == PlanCode::Free {
        entitlement.storage_kb = entitlement.storage_kb - DEFAULT_FREE_STORAGE_KB
            + CONFIG.user_attachment_limit().unwrap_or(DEFAULT_FREE_STORAGE_KB);
    }
    Ok(entitlement)
}
pub async fn for_org(org: &OrganizationId, conn: &DbConn) -> ApiResult<Entitlement> {
    Ok(Entitlement::from_rows(&Subscription::all_for_org(org, conn).await?))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::billing::provider::Owner;
    fn row(plan: PlanCode, quantity: i32, status: &str) -> Subscription {
        let mut row = Subscription::new(Owner::User("user".into()), plan, quantity);
        row.status = status.into(); row
    }
    #[test]
    fn plans_addons_and_statuses_compose_without_org_leakage() {
        let mut rows = vec![row(PlanCode::Family, 1, "active"), row(PlanCode::HostedAgent, 2, "trialing"), row(PlanCode::StoragePlus, 3, "past_due")];
        let plan = Entitlement::from_rows(&rows);
        assert_eq!(plan.base_plan, PlanCode::Family); assert_eq!(plan.seats, 6);
        assert_eq!(plan.storage_kb, 85 * DEFAULT_FREE_STORAGE_KB);
        // The Family base keeps its daily 1000; the two Hosted Agent packs
        // add only to the monthly bucket, at 3000 per pack.
        assert_eq!(plan.decision_per_day, 1000);
        assert_eq!(plan.decision_per_month, 6000); assert!(plan.hosted_agent);
        rows[0].status = "canceled".into(); rows[1].status = "paused".into();
        let plan = Entitlement::from_rows(&rows);
        assert_eq!(plan.base_plan, PlanCode::Free); assert!(!plan.hosted_agent);
        assert_eq!(plan.decision_per_day, FREE_RELAY_DAILY_LIMIT);
        assert_eq!(plan.decision_per_month, 0);
        assert_eq!(plan.storage_kb, PlanSpec::for_code(PlanCode::Free).storage_kb + 75 * DEFAULT_FREE_STORAGE_KB);
    }
    #[test]
    fn specs_split_the_daily_base_and_the_monthly_agent_allowance() {
        for (plan, daily, monthly) in [
            (PlanCode::Free, FREE_RELAY_DAILY_LIMIT, 0),
            (PlanCode::Family, 1000, 0),
            (PlanCode::Office, 5000, 0),
            (PlanCode::StoragePlus, 0, 0),
            (PlanCode::HostedAgent, 0, HOSTED_AGENT_MONTHLY_PER_PACK),
        ] {
            let spec = PlanSpec::for_code(plan);
            assert_eq!((spec.decision_per_day, spec.decision_per_month), (daily, monthly));
        }
        // Quantity multiplies the monthly bucket only.
        let entitlement = Entitlement::from_rows(&[row(PlanCode::HostedAgent, 3, "active")]);
        assert_eq!(entitlement.decision_per_day, FREE_RELAY_DAILY_LIMIT);
        assert_eq!(entitlement.decision_per_month, 9000);
    }
    #[test]
    fn office_seats_are_purchased_quantity_not_inherited_fixed_limit() {
        let plan = Entitlement::from_rows(&[row(PlanCode::Office, 73, "active")]);
        assert_eq!(plan.seats, 73);
        assert_eq!(plan.decision_per_day, 5000); assert_eq!(plan.decision_per_month, 0);
        assert_eq!(Entitlement::from_rows(&[]).base_plan, PlanCode::Free);
    }
}
