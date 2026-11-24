use serde::{Deserialize, Serialize};
use crate::{api::ApiResult, db::models::{OrganizationId, UserId}};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PlanCode { Free, Family, Office, StoragePlus, HostedAgent }
impl PlanCode {
    pub fn as_str(self) -> &'static str { match self {
        Self::Free => "free", Self::Family => "family", Self::Office => "office",
        Self::StoragePlus => "storage_plus", Self::HostedAgent => "hosted_agent",
    }}
    pub fn parse(value: &str) -> Option<Self> { match value {
        "free" => Some(Self::Free), "family" => Some(Self::Family), "office" => Some(Self::Office),
        "storage_plus" => Some(Self::StoragePlus), "hosted_agent" => Some(Self::HostedAgent), _ => None,
    }}
    pub fn kind(self) -> &'static str { match self {
        Self::Free | Self::Family | Self::Office => "base", _ => "addon",
    }}
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", content = "id", rename_all = "camelCase")]
pub enum Owner { User(UserId), Organization(OrganizationId) }
impl Owner {
    pub fn id(&self) -> &str { match self { Self::User(id) => id.as_ref(), Self::Organization(id) => id.as_ref() } }
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Status { Active, Trialing, PastDue, Paused, Canceled }
impl Status {
    pub fn as_str(self) -> &'static str { match self {
        Self::Active => "active", Self::Trialing => "trialing", Self::PastDue => "past_due",
        Self::Paused => "paused", Self::Canceled => "canceled",
    }}
}
#[derive(Clone, Debug)]
pub enum BillingEvent {
    SubscriptionChanged { owner: Owner, provider_subscription_id: String, provider_customer_id: String,
        plan_code: PlanCode, quantity: i32, status: Status, current_period_end: i64, occurred_at: chrono::NaiveDateTime, campaign: &'static str },
    CreditsPurchased { owner: Owner, units: i64 },
    PaymentFailed { owner: Owner },
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckoutSession {
    pub transaction_id: String,
    pub client_token: String,
    pub environment: String,
}
#[rocket::async_trait]
pub trait Provider: Send + Sync {
    fn name(&self) -> &'static str;
    fn verify_and_parse(&self, signature: &str, body: &[u8]) -> ApiResult<(String, Option<BillingEvent>)>;
    async fn checkout(&self, owner: &Owner, plan: PlanCode, quantity: i32, campaign: &str) -> ApiResult<CheckoutSession>;
    async fn portal_url(&self, customer_id: &str) -> ApiResult<String>;
}
