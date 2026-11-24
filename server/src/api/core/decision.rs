use rocket::{http::Status, request::{FromRequest, Outcome}, serde::json::Json, Request, Route};
use subtle::ConstantTimeEq;
use crate::{api::{EmptyResult, JsonResult}, auth::Headers, billing::{balance, entitlement, provider::{Owner, PlanCode}}, db::{DbConn, models::{DecisionUsage, Membership, MembershipStatus, OrganizationId, TelemetryDaily, User, UserId}}, mail, CONFIG};

pub fn routes() -> Vec<Route> { routes![consume, usage] }
#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ConsumeData { organization_id: Option<OrganizationId> }
#[post("/decision/consume", data = "<data>")]
async fn consume(headers: Headers, data: Option<Json<ConsumeData>>, conn: DbConn) -> JsonResult {
    let org = data.map(Json::into_inner).unwrap_or_default().organization_id;
    let owner = super::billing::owner_for(&headers, org, &conn, false).await?;
    let plan = match &owner { Owner::User(id) => entitlement::for_user(id, &conn).await?, Owner::Organization(id) => entitlement::for_org(id, &conn).await? };
    let result = balance::consume(owner.id(), plan.decision_per_day, plan.decision_per_month, &conn).await?;
    if result.notify_low && plan.hosted_agent && CONFIG.mail_enabled() {
        if mail::send_decision_allowance_low(&headers.user.email, result.credit_units, plan.decision_per_month).await.is_err() { warn!("Decision allowance notification failed"); }
    }
    Ok(Json(serde_json::to_value(result)?))
}
struct RelayKey;
#[rocket::async_trait]
impl<'r> FromRequest<'r> for RelayKey {
    type Error = ();
    async fn from_request(request: &'r Request<'_>) -> Outcome<Self, ()> {
        let expected = CONFIG.relay_service_key();
        let supplied = request.headers().get_one("X-Relay-Key").unwrap_or_default();
        if !expected.is_empty() && bool::from(expected.as_bytes().ct_eq(supplied.as_bytes())) { Outcome::Success(Self) }
        else { Outcome::Error((Status::Unauthorized, ())) }
    }
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct UsageData {
    account: UserId, organization_id: Option<OrganizationId>, model: String,
    input_tokens: Option<i64>, output_tokens: Option<i64>, cost_micros: Option<i64>, latency_ms: i64, result: String,
}
#[post("/decision/usage", data = "<data>")]
async fn usage(_key: RelayKey, data: Json<UsageData>, conn: DbConn) -> EmptyResult {
    let data = data.into_inner();
    if !CONFIG.relay_usage_models().split(',').any(|model| model.trim() == data.model)
        || !matches!(data.result.as_str(), "ok" | "error")
        || data.input_tokens.into_iter().chain(data.output_tokens).chain(data.cost_micros).chain(Some(data.latency_ms))
            .any(|value| !(0..=1_000_000_000_000).contains(&value)) {
        err!("Invalid Decision usage report");
    }
    if User::find_by_uuid(&data.account, &conn).await.is_none() { err!("Unknown usage account"); }
    let plan = if let Some(org) = data.organization_id {
        if Membership::find_by_user_and_org(&data.account, &org, &conn).await.is_none_or(|member| member.status != MembershipStatus::Confirmed as i32) {
            err!("Invalid usage organization");
        }
        entitlement::for_org(&org, &conn).await?
    } else { entitlement::for_user(&data.account, &conn).await? };
    let plan_code = if plan.hosted_agent { PlanCode::HostedAgent.as_str() } else { plan.base_plan.as_str() };
    TelemetryDaily::record_decision_usage(DecisionUsage { plan: plan_code.to_owned(),
        input_tokens: data.input_tokens, output_tokens: data.output_tokens,
        cost_micros: data.cost_micros, latency_ms: Some(data.latency_ms), succeeded: data.result == "ok",
    }, &conn).await
}
