use crate::{
    CONFIG, Error,
    auth::{JWT_ALGORITHM, PUBLIC_RSA_KEY, encode_jwt},
};
use chrono::Utc;
use jsonwebtoken::Validation;
use rocket::{
    http::Status,
    request::{FromRequest, Outcome, Request},
};

pub const AUDIENCE: &str = "vowkey-decision-relay";
pub const SCOPES: [&str; 2] = ["decision.guest", "form.describe.guest"];
#[derive(Debug, Serialize, Deserialize)]
pub struct GuestDecisionClaims {
    pub iss: String,
    pub aud: String,
    pub sub: String,
    pub scope: Vec<String>,
    pub nbf: i64,
    pub exp: i64,
}
impl GuestDecisionClaims {
    pub fn new(installation: &str) -> Self {
        let nbf = Utc::now().timestamp();
        Self {
            iss: format!("{}|guest-decision", CONFIG.domain_origin()),
            aud: AUDIENCE.into(),
            sub: installation.into(),
            scope: SCOPES.iter().map(|s| (*s).into()).collect(),
            nbf,
            exp: nbf + 3600,
        }
    }
    pub fn token(&self) -> String {
        encode_jwt(self)
    }
    pub fn valid_scope(&self, scope: &str) -> bool {
        SCOPES.contains(&scope) && self.scope.iter().any(|s| s == scope)
    }
}
pub fn decode(token: &str) -> Result<GuestDecisionClaims, Error> {
    let mut validation = Validation::new(JWT_ALGORITHM);
    validation.leeway = 0;
    validation.validate_nbf = true;
    validation.set_issuer(&[format!("{}|guest-decision", CONFIG.domain_origin())]);
    validation.set_audience(&[AUDIENCE]);
    let claims = jsonwebtoken::decode::<GuestDecisionClaims>(token, PUBLIC_RSA_KEY.wait(), &validation)?.claims;
    if uuid::Uuid::parse_str(&claims.sub).is_err()
        || claims.exp - claims.nbf != 3600
        || claims.scope.len() != 2
        || !SCOPES.iter().all(|s| claims.valid_scope(s))
    {
        return Err(Error::new_msg("Invalid guest decision claims").with_code(401));
    }
    Ok(claims)
}
pub struct GuestDecisionHeaders(pub GuestDecisionClaims);
#[rocket::async_trait]
impl<'r> FromRequest<'r> for GuestDecisionHeaders {
    type Error = &'static str;
    async fn from_request(request: &'r Request<'_>) -> Outcome<Self, Self::Error> {
        match request
            .headers()
            .get_one("Authorization")
            .and_then(|h| h.strip_prefix("Bearer "))
            .and_then(|t| decode(t).ok())
        {
            Some(claims) => Outcome::Success(Self(claims)),
            None => Outcome::Error((Status::Unauthorized, "Invalid guest decision token")),
        }
    }
}
