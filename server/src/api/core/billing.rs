use rocket::{data::ToByteUnit, http::Status, request::{FromRequest, Outcome}, serde::json::Json, Data, Request, Route};
use serde_json::Value;
use crate::{api::{EmptyResult, JsonResult}, auth::Headers, billing::{balance, entitlement, paddle::{self, Paddle}, provider::{Owner, PlanCode, Provider}, store}, db::{DbConn, models::{Attachment, Membership, MembershipStatus, MembershipType, Organization, OrganizationId, Subscription, User}}, mail, Error, CONFIG};

pub fn routes() -> Vec<Route> { routes![get_entitlement, checkout, portal, webhook] }
pub async fn owner_for(headers: &Headers, org: Option<OrganizationId>, conn: &DbConn, manage: bool) -> Result<Owner, Error> {
    let Some(org) = org else { return Ok(Owner::User(headers.user.uuid.clone())) };
    let member = Membership::find_by_user_and_org(&headers.user.uuid, &org, conn).await
        .filter(|member| member.status == MembershipStatus::Confirmed as i32)
        .ok_or_else(|| Error::new_msg("Organization access denied").with_code(403))?;
    if manage && !matches!(member.atype, value if value == MembershipType::Owner as i32 || value == MembershipType::Admin as i32) {
        return Err(Error::new_msg("Only an organization owner or admin can manage billing").with_code(403));
    }
    Ok(Owner::Organization(org))
}
async fn owner_json(owner: &Owner, conn: &DbConn) -> Result<Value, Error> {
    let (plan, storage_used) = match owner {
        Owner::User(id) => (entitlement::for_user(id, conn).await?, Attachment::size_by_user(id, conn).await),
        Owner::Organization(id) => (entitlement::for_org(id, conn).await?, Attachment::size_by_org(id, conn).await),
    };
    let balance = balance::read(owner.id(), conn).await?;
    let mut value = serde_json::to_value(plan)?;
    value["storageUsedBytes"] = json!(storage_used);
    value["usedToday"] = json!(balance.used_today);
    value["usedThisMonth"] = json!(balance.used_this_month);
    value["creditUnits"] = json!(balance.credit_units);
    Ok(value)
}
#[get("/billing/entitlement")]
async fn get_entitlement(headers: Headers, conn: DbConn) -> JsonResult {
    let personal = owner_json(&Owner::User(headers.user.uuid.clone()), &conn).await?;
    let mut organizations = Vec::new();
    for member in Membership::find_confirmed_by_user(&headers.user.uuid, &conn).await {
        let Some(org) = Organization::find_by_uuid(&member.org_uuid, &conn).await else { continue };
        let mut value = owner_json(&Owner::Organization(org.uuid.clone()), &conn).await?;
        value["organizationId"] = json!(org.uuid); value["name"] = json!(org.name);
        value["canManageBilling"] = json!(member.atype == MembershipType::Owner as i32 || member.atype == MembershipType::Admin as i32);
        organizations.push(value);
    }
    let catalog = paddle::prices()?.into_iter().map(|(id, price)| json!({"priceId":id,"planCode":price.plan_code,
        "kind":price.kind,"available":CONFIG.billing_provider() == "paddle", "creditPack":price.credit_units > 0,
        "billingInterval":price.billing_interval})).collect::<Vec<_>>();
    Ok(Json(json!({"personal":personal,"organizations":organizations,"catalog":catalog,"billingEnabled":CONFIG.billing_provider() == "paddle"})))
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CheckoutData { plan_code: PlanCode, quantity: i32, organization_id: Option<OrganizationId>, price_id: Option<String>, #[serde(default)] credit_pack: bool }
#[post("/billing/checkout", data = "<data>")]
async fn checkout(data: Json<CheckoutData>, headers: Headers, conn: DbConn) -> JsonResult {
    let data = data.into_inner();
    if data.quantity < 1 || data.quantity > 100_000 || data.plan_code == PlanCode::Free
        || (data.credit_pack && data.plan_code != PlanCode::HostedAgent)
        || (data.plan_code == PlanCode::Family && data.quantity != 1) { err!("Invalid plan quantity"); }
    let owner = owner_for(&headers, data.organization_id, &conn, true).await?;
    if data.plan_code == PlanCode::Office && !matches!(owner, Owner::Organization(_)) { err!("A Business plan belongs to an organization"); }
    let rows = match &owner { Owner::User(id) => Subscription::all_for_user(id, &conn).await?, Owner::Organization(id) => Subscription::all_for_org(id, &conn).await? };
    if data.plan_code.kind() == "base" && rows.iter().any(|row| row.kind == "base" && row.plan_code != "free" && row.provider.is_some() && row.is_entitled()) {
        return Err(Error::new_msg("Manage the existing plan through billing").with_code(409));
    }
    let adapter = Paddle::configured()?;
    let session = if data.price_id.is_none() && !data.credit_pack {
        adapter.checkout(&owner, data.plan_code, data.quantity, &headers.user.acquisition_campaign).await?
    } else {
        adapter.checkout_price(&owner, data.plan_code, data.quantity, data.price_id.as_deref(), data.credit_pack, &headers.user.acquisition_campaign).await?
    };
    Ok(Json(serde_json::to_value(session)?))
}
#[get("/billing/portal?<organizationId>")]
#[allow(non_snake_case)]
async fn portal(organizationId: Option<OrganizationId>, headers: Headers, conn: DbConn) -> JsonResult {
    let owner = owner_for(&headers, organizationId, &conn, true).await?;
    let customer = customer_for(&owner, &conn).await?.ok_or_else(|| Error::new_msg("No billing account exists").with_code(404))?;
    Ok(Json(json!({"url":Paddle::configured()?.portal_url(&customer).await?})))
}
async fn customer_for(owner: &Owner, conn: &DbConn) -> Result<Option<String>, Error> {
    let rows = match owner { Owner::User(id) => Subscription::all_for_user(id, conn).await?, Owner::Organization(id) => Subscription::all_for_org(id, conn).await? };
    Ok(rows.into_iter().filter(|row| row.provider.as_deref() == Some("paddle"))
        .max_by_key(|row| row.updated_at).and_then(|row| row.provider_customer_id))
}
struct Signature(String);
#[rocket::async_trait]
impl<'r> FromRequest<'r> for Signature {
    type Error = ();
    async fn from_request(request: &'r Request<'_>) -> Outcome<Self, ()> {
        match request.headers().get_one("Paddle-Signature") {
            Some(value) if value.len() <= 1024 => Outcome::Success(Self(value.into())),
            _ => Outcome::Error((Status::Unauthorized, ())),
        }
    }
}
#[post("/billing/webhooks/<provider>", data = "<data>")]
async fn webhook(provider: &str, signature: Signature, data: Data<'_>, conn: DbConn) -> EmptyResult {
    let adapter = Paddle::configured()?;
    if provider != adapter.name() { return Err(Error::new_msg("Unknown payment provider").with_code(404)); }
    let body = data.open(1.mebibytes()).into_bytes().await?;
    if !body.is_complete() { return Err(Error::new_msg("Payment event too large").with_code(413)); }
    let (event_id, event) = adapter.verify_and_parse(&signature.0, &body.value)?;
    let applied = store::apply(adapter.name(), &event_id, event, &conn).await?;
    if CONFIG.mail_enabled() {
        if let Some(owner) = applied.owner {
            if let Some(seats) = applied.seats {
                if let Owner::Organization(id) = &owner {
                    if let Some(org) = Organization::find_by_uuid(id, &conn).await {
                        for member in Membership::find_by_org_and_type(id, MembershipType::Owner, &conn).await {
                            if let Some(user) = User::find_by_uuid(&member.user_uuid, &conn).await {
                                if mail::send_office_seats_changed(&user.email, &org.name, seats).await.is_err() { warn!("Office seat notification failed"); }
                            }
                        }
                    }
                }
            }
            if applied.payment_failed {
                if let Some(customer) = customer_for(&owner, &conn).await? {
                    let url = adapter.portal_url(&customer).await?;
                    let address = match &owner {
                        Owner::User(id) => User::find_by_uuid(id, &conn).await.map(|user| user.email),
                        Owner::Organization(id) => Organization::find_by_uuid(id, &conn).await.map(|org| org.billing_email),
                    };
                    if let Some(address) = address { if mail::send_payment_failed(&address, &url).await.is_err() { warn!("Payment failure notification failed"); } }
                }
            }
        }
    }
    Ok(())
}
