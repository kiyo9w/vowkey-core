use std::{collections::BTreeMap, time::Duration};
use chrono::{DateTime, Utc};
use reqwest::Method;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use crate::{api::ApiResult, db::models::campaign_slug, http_client::make_http_request, Error, CONFIG};
use super::provider::{BillingEvent, CheckoutSession, Owner, PlanCode, Provider, Status};

#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct PriceSpec {
    pub plan_code: PlanCode,
    pub kind: String,
    #[serde(default)] pub credit_units: i64,
    #[serde(default)] pub billing_interval: Option<String>,
}
pub fn prices() -> ApiResult<BTreeMap<String, PriceSpec>> {
    let prices: BTreeMap<String, PriceSpec> = serde_json::from_str(&CONFIG.billing_price_map())?;
    for (id, price) in &prices {
        if id.len() > 128 || !id.starts_with("pri_") || price.plan_code == PlanCode::Free
            || price.kind != price.plan_code.kind() || price.credit_units < 0
            || (price.credit_units > 0 && price.plan_code != PlanCode::HostedAgent)
            || price.billing_interval.as_deref().is_some_and(|value| !matches!(value, "month" | "year")) {
            err!("Invalid billing price map");
        }
    }
    Ok(prices)
}
pub struct Paddle { secret: String, api_key: String, environment: String }
impl Paddle {
    pub fn configured() -> ApiResult<Self> {
        if CONFIG.billing_provider() != "paddle" { return Err(Error::new_msg("Billing is not enabled").with_code(503)); }
        Ok(Self { secret: CONFIG.paddle_webhook_secret(), api_key: CONFIG.paddle_api_key(), environment: CONFIG.paddle_environment() })
    }
    fn base_url(&self) -> &'static str { if self.environment == "production" { "https://api.paddle.com" } else { "https://sandbox-api.paddle.com" } }
    async fn post(&self, path: &str, body: Value) -> ApiResult<Value> {
        if self.api_key.is_empty() { return Err(Error::new_msg("Billing is not configured").with_code(503)); }
        let response = make_http_request(Method::POST, &format!("{}{path}", self.base_url()))?
            .timeout(Duration::from_secs(20)).bearer_auth(&self.api_key).json(&body).send().await
            .map_err(|_| Error::new_msg("Payment provider unavailable").with_code(502))?;
        if !response.status().is_success() { return Err(Error::new_msg("Payment provider rejected the request").with_code(502)); }
        let value: Value = response.json().await.map_err(|_| Error::new_msg("Invalid payment provider response").with_code(502))?;
        Ok(value)
    }
    pub async fn checkout_price(&self, owner: &Owner, plan: PlanCode, quantity: i32, selected: Option<&str>, credit_pack: bool, campaign: &str) -> ApiResult<CheckoutSession> {
        let catalog = prices()?;
        let (price_id, _) = catalog.iter().find(|(id, price)| price.plan_code == plan
            && (price.credit_units > 0) == credit_pack && selected.is_none_or(|selected| selected == id.as_str()))
            .ok_or_else(|| Error::new_msg("This plan is not available"))?;
        let response = self.post("/transactions", json!({"items":[{"price_id":price_id,"quantity":quantity}],
            "collection_mode":"automatic", "custom_data":{"owner":owner,"campaign":campaign_slug(campaign)}})).await?;
        let transaction_id = required(&response["data"], "id")?;
        Ok(CheckoutSession { transaction_id, client_token: CONFIG.paddle_client_token(), environment: self.environment.clone() })
    }
    fn parse(&self, body: &[u8]) -> ApiResult<(String, Option<BillingEvent>)> {
        let envelope: Value = serde_json::from_slice(body)?;
        let event_id = required(&envelope, "event_id")?;
        let event_type = required(&envelope, "event_type")?;
        if !event_id.starts_with("evt_") { err!("Invalid payment event id"); }
        if !matches!(event_type.as_str(), "subscription.created" | "subscription.updated" | "subscription.canceled"
            | "subscription.paused" | "subscription.resumed" | "subscription.activated" | "subscription.trialing"
            | "subscription.past_due" | "transaction.completed" | "transaction.payment_failed") { return Ok((event_id, None)); }
        let data = &envelope["data"];
        let owner: Owner = serde_json::from_value(data["custom_data"]["owner"].clone())?;
        if uuid::Uuid::parse_str(owner.id()).is_err() { err!("Invalid payment owner"); }
        if event_type == "transaction.payment_failed" { return Ok((event_id, Some(BillingEvent::PaymentFailed { owner }))); }
        let catalog = prices()?;
        let items = data["items"].as_array().ok_or_else(|| Error::new_msg("Missing payment items"))?;
        if event_type == "transaction.completed" {
            let mut units = 0_i64;
            for item in items {
                let price_id = required(&item["price"], "id")?;
                let price = catalog.get(&price_id).ok_or_else(|| Error::new_msg("Unknown payment price"))?;
                let quantity = quantity(item)?;
                units = price.credit_units.checked_mul(i64::from(quantity)).and_then(|units_for_item| units.checked_add(units_for_item))
                    .ok_or_else(|| Error::new_msg("Credit quantity overflow"))?;
            }
            return Ok((event_id, (units > 0).then_some(BillingEvent::CreditsPurchased { owner, units })));
        }
        if items.len() != 1 { err!("A subscription must contain one plan; add-ons use separate subscriptions"); }
        let price_id = required(&items[0]["price"], "id")?;
        let price = catalog.get(&price_id).ok_or_else(|| Error::new_msg("Unknown payment price"))?;
        if price.credit_units != 0 { err!("Credit packs cannot recur"); }
        let status: Status = serde_json::from_value(data["status"].clone())?;
        let current_period_end = data["current_billing_period"]["ends_at"].as_str()
            .map(|value| DateTime::parse_from_rfc3339(value).map(|date| date.timestamp())).transpose()
            .map_err(|_| Error::new_msg("Invalid billing period"))?.unwrap_or(0);
        let occurred_at = DateTime::parse_from_rfc3339(&required(&envelope, "occurred_at")?)
            .map_err(|_| Error::new_msg("Invalid payment event time"))?.naive_utc();
        Ok((event_id, Some(BillingEvent::SubscriptionChanged { owner,
            provider_subscription_id: required(data, "id")?, provider_customer_id: required(data, "customer_id")?,
            plan_code: price.plan_code, quantity: quantity(&items[0])?, status, current_period_end, occurred_at,
            campaign: campaign_slug(data["custom_data"]["campaign"].as_str().unwrap_or("")) })))
    }
}
fn required(value: &Value, name: &str) -> ApiResult<String> {
    value[name].as_str().filter(|value| !value.is_empty() && value.len() <= 128).map(str::to_owned)
        .ok_or_else(|| Error::new_msg("Invalid payment event field"))
}
fn quantity(value: &Value) -> ApiResult<i32> {
    value["quantity"].as_i64().and_then(|quantity| i32::try_from(quantity).ok()).filter(|quantity| *quantity > 0)
        .ok_or_else(|| Error::new_msg("Invalid payment quantity"))
}
fn verify(signature: &str, body: &[u8], secret: &str, now: i64) -> ApiResult<()> {
    let mut timestamp = None;
    let mut signatures = Vec::new();
    for part in signature.split(';') {
        match part.trim().split_once('=') {
            Some(("ts", value)) if timestamp.is_none() => timestamp = Some(value),
            Some(("h1", value)) => signatures.push(value),
            _ => return Err(Error::new_msg("Invalid payment signature").with_code(401)),
        }
    }
    let timestamp = timestamp.ok_or_else(|| Error::new_msg("Missing payment signature").with_code(401))?;
    let seconds: i64 = timestamp.parse().map_err(|_| Error::new_msg("Invalid payment timestamp").with_code(401))?;
    if secret.is_empty() || now.abs_diff(seconds) > 5 { return Err(Error::new_msg("Expired payment signature").with_code(401)); }
    let key = ring::hmac::Key::new(ring::hmac::HMAC_SHA256, secret.as_bytes());
    let mut message = Vec::with_capacity(timestamp.len() + 1 + body.len());
    message.extend_from_slice(timestamp.as_bytes()); message.push(b':'); message.extend_from_slice(body);
    if signatures.into_iter().any(|signature| data_encoding::HEXLOWER.decode(signature.as_bytes()).is_ok_and(|tag| ring::hmac::verify(&key, &message, &tag).is_ok())) { Ok(()) }
    else { Err(Error::new_msg("Invalid payment signature").with_code(401)) }
}
#[rocket::async_trait]
impl Provider for Paddle {
    fn name(&self) -> &'static str { "paddle" }
    fn verify_and_parse(&self, signature: &str, body: &[u8]) -> ApiResult<(String, Option<BillingEvent>)> {
        verify(signature, body, &self.secret, Utc::now().timestamp())?; self.parse(body)
    }
    async fn checkout(&self, owner: &Owner, plan: PlanCode, quantity: i32, campaign: &str) -> ApiResult<CheckoutSession> {
        self.checkout_price(owner, plan, quantity, None, false, campaign).await
    }
    async fn portal_url(&self, customer_id: &str) -> ApiResult<String> {
        if !customer_id.starts_with("ctm_") || !customer_id.bytes().all(|byte| byte.is_ascii_alphanumeric() || byte == b'_') { err!("Invalid payment customer"); }
        let response = self.post(&format!("/customers/{customer_id}/portal-sessions"), json!({})).await?;
        let url = response["data"]["urls"]["general"]["overview"].as_str().ok_or_else(|| Error::new_msg("Missing billing portal"))?;
        let parsed = url::Url::parse(url).map_err(|_| Error::new_msg("Invalid billing portal"))?;
        if parsed.scheme() != "https" || !matches!(parsed.host_str(), Some("customer-portal.paddle.com" | "sandbox-customer-portal.paddle.com")) { err!("Invalid billing portal"); }
        Ok(url.to_owned())
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    fn signature(body: &[u8], secret: &str, now: i64) -> String {
        let key = ring::hmac::Key::new(ring::hmac::HMAC_SHA256, secret.as_bytes());
        let message = [now.to_string().as_bytes(), b":", body].concat();
        format!("ts={now};h1={}", data_encoding::HEXLOWER.encode(ring::hmac::sign(&key, &message).as_ref()))
    }
    #[test]
    fn signatures_bind_raw_body_and_timestamp_and_allow_rotated_signatures() {
        let body = br#"{"event_id":"evt_fixture"}"#;
        let sig = signature(body, "fixture-secret", 1000);
        assert!(verify(&sig, body, "fixture-secret", 1005).is_ok());
        assert!(verify(&sig, body, "fixture-secret", 1006).is_err());
        assert!(verify(&sig, body, "fixture-secret", 994).is_err());
        assert!(verify(&sig, b"changed", "fixture-secret", 1000).is_err());
        assert!(verify(&sig, body, "different", 1000).is_err());
        assert!(verify(&format!("{sig};h1=bad"), body, "fixture-secret", 1000).is_ok());
    }
}
