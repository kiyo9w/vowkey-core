use std::{sync::LazyLock, time::Duration};

use chrono::Utc;
use derive_more::{AsRef, Deref, Display, From, Into};
use url::Url;

use crate::{
    CONFIG, api::ApiResult, auth, crypto,
    auth::{AuthMethod, AuthTokens, BW_EXPIRATION, DEFAULT_REFRESH_VALIDITY, TokenWrapper},
    db::{DbConn, models::{Device, OIDCAuthenticatedUser, SsoAuth, SsoUser, Subscription, User}},
    error::Error, sso_client::Client,
};

pub static FAKE_SSO_IDENTIFIER: &str = "00000000-01DC-01DC-01DC-000000000000";

pub fn is_personal_social_identifier(identifier: &str) -> bool {
    let trimmed = identifier.trim();
    trimmed.eq_ignore_ascii_case(FAKE_SSO_IDENTIFIER)
        || trimmed.eq_ignore_ascii_case("google")
        || trimmed.eq_ignore_ascii_case("github")
        || trimmed.eq_ignore_ascii_case("apple")
}

pub fn social_connector_hint<'a>(
    domain_hint: Option<&'a str>,
    provider: Option<&'a str>,
    state: Option<&'a str>,
) -> Option<&'static str> {
    let match_connector = |val: &str| -> Option<&'static str> {
        let trimmed = val.trim();
        if trimmed.eq_ignore_ascii_case("google") {
            Some("google")
        } else if trimmed.eq_ignore_ascii_case("github") {
            Some("github")
        } else {
            None
        }
    };

    provider
        .and_then(match_connector)
        .or_else(|| domain_hint.and_then(match_connector))
        .or_else(|| {
            state
                .and_then(|s| s.rsplit_once("_identifier="))
                .and_then(|(_, ident)| ident.split('&').next())
                .and_then(match_connector)
        })
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SsoProvider {
    Enterprise,
    Google,
    Apple,
}

impl SsoProvider {
    pub fn is_google_hint(val: Option<&str>) -> bool {
        val.is_some_and(|v| v.trim().eq_ignore_ascii_case("google"))
    }

    pub fn is_apple_hint(val: Option<&str>) -> bool {
        val.is_some_and(|v| v.trim().eq_ignore_ascii_case("apple"))
    }

    pub fn from_request(
        domain_hint: Option<&str>,
        org_identifier: Option<&str>,
        provider: Option<&str>,
        state: Option<&str>,
    ) -> Self {
        if CONFIG.apple_sso_enabled()
            && (Self::is_apple_hint(provider)
                || Self::is_apple_hint(domain_hint)
                || Self::is_apple_hint(org_identifier)
                || state.is_some_and(Self::state_has_identifier("apple")))
        {
            Self::Apple
        } else if CONFIG.google_sso_enabled()
            && (Self::is_google_hint(provider)
                || Self::is_google_hint(domain_hint)
                || Self::is_google_hint(org_identifier)
                || state.is_some_and(Self::state_has_identifier("google")))
        {
            Self::Google
        } else {
            Self::Enterprise
        }
    }

    pub fn from_state(state: &str) -> Self {
        if CONFIG.apple_sso_enabled() && Self::state_has_identifier("apple")(state) {
            Self::Apple
        } else if CONFIG.google_sso_enabled()
            && (Self::state_has_identifier("google")(state) || !CONFIG.sso_enabled())
        {
            Self::Google
        } else {
            Self::Enterprise
        }
    }

    fn state_has_identifier(identifier: &'static str) -> impl Fn(&str) -> bool {
        move |state| {
            state.rsplit_once("_identifier=").is_some_and(|(_, ident)| {
                ident.split('&').next().unwrap_or(ident).trim().eq_ignore_ascii_case(identifier)
            })
        }
    }
}

static SSO_JWT_ISSUER: LazyLock<String> = LazyLock::new(|| format!("{}|sso", CONFIG.domain_origin()));

pub static SSO_AUTH_EXPIRATION: LazyLock<chrono::Duration> =
    LazyLock::new(|| chrono::TimeDelta::try_minutes(10).unwrap());

#[derive(
    Clone,
    Debug,
    Default,
    DieselNewType,
    FromForm,
    PartialEq,
    Eq,
    Hash,
    Serialize,
    Deserialize,
    AsRef,
    Deref,
    Display,
    From,
)]
#[deref(forward)]
#[from(forward)]
pub struct OIDCCode(String);

#[derive(
    Clone,
    Debug,
    Default,
    DieselNewType,
    FromForm,
    PartialEq,
    Eq,
    Hash,
    Serialize,
    Deserialize,
    AsRef,
    Deref,
    Display,
    From,
    Into,
)]
#[deref(forward)]
#[into(owned)]
pub struct OIDCCodeChallenge(String);

#[derive(
    Clone,
    Debug,
    Default,
    DieselNewType,
    FromForm,
    PartialEq,
    Eq,
    Hash,
    Serialize,
    Deserialize,
    AsRef,
    Deref,
    Display,
    Into,
)]
#[deref(forward)]
#[into(owned)]
pub struct OIDCCodeVerifier(String);

#[derive(
    Clone,
    Debug,
    Default,
    DieselNewType,
    FromForm,
    PartialEq,
    Eq,
    Hash,
    Serialize,
    Deserialize,
    AsRef,
    Deref,
    Display,
    From,
)]
#[deref(forward)]
#[from(forward)]
pub struct OIDCState(String);

#[derive(Debug, Serialize, Deserialize)]
struct SsoTokenJwtClaims {
    // Not before
    pub nbf: i64,
    // Expiration time
    pub exp: i64,
    // Issuer
    pub iss: String,
    // Subject
    pub sub: String,
}

pub fn encode_ssotoken_claims() -> String {
    let time_now = Utc::now();
    let claims = SsoTokenJwtClaims {
        nbf: time_now.timestamp(),
        exp: (time_now + chrono::TimeDelta::try_minutes(2).unwrap()).timestamp(),
        iss: SSO_JWT_ISSUER.to_string(),
        sub: "vowkey".to_owned(),
    };

    auth::encode_jwt(&claims)
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct BasicTokenClaims {
    iat: Option<i64>,
    nbf: Option<i64>,
    exp: i64,
}

#[derive(Deserialize)]
struct BasicTokenClaimsValidation {
    exp: u64,
    iss: String,
}

impl BasicTokenClaims {
    fn nbf(&self) -> i64 {
        self.nbf.or(self.iat).unwrap_or_else(|| Utc::now().timestamp())
    }
}

fn decode_token_claims(token_name: &str, token: &str) -> ApiResult<BasicTokenClaims> {
    // We need to manually validate this token, since `insecure_decode` does not do this
    match jsonwebtoken::dangerous::insecure_decode::<BasicTokenClaimsValidation>(token) {
        Ok(btcv) => {
            let now = jsonwebtoken::get_current_timestamp();
            let validate_claim = btcv.claims;
            // Validate the exp in the claim with a leeway of 60 seconds, same as jsonwebtoken does
            if validate_claim.exp < now - 60 {
                err_silent!(format!("Expired Signature for base token claim from {token_name}"))
            }
            if validate_claim.iss.ne(&CONFIG.sso_authority()) {
                err_silent!(format!("Invalid Issuer for base token claim from {token_name}"))
            }

            // All is validated and ok, lets decode again using the wanted struct
            let btc = jsonwebtoken::dangerous::insecure_decode::<BasicTokenClaims>(token).unwrap();
            Ok(btc.claims)
        }
        Err(err) => err_silent!(format!("Failed to decode basic token claims from {token_name}: {err}")),
    }
}

pub fn decode_state(base64_state: &str) -> ApiResult<OIDCState> {
    let state = if let Ok(vec) = data_encoding::BASE64.decode(base64_state.as_bytes()) {
        if let Ok(valid) = String::from_utf8(vec) {
            OIDCState(valid)
        } else {
            err!(format!("Invalid utf8 chars in {} after base64 decoding", base64_state.escape_debug()))
        }
    } else {
        err!(format!("Failed to decode {} using base64", base64_state.escape_debug()))
    };

    Ok(state)
}

// redirect_uri from: https://github.com/bitwarden/server/blob/main/src/Identity/IdentityServer/StaticClientStore.cs
pub async fn authorize_url(
    provider: SsoProvider,
    state: OIDCState,
    client_challenge: OIDCCodeChallenge,
    client_id: &str,
    raw_redirect_uri: &str,
    binding_hash: Option<String>,
    connector: Option<&str>,
    conn: DbConn,
) -> ApiResult<Url> {
    // The desktop app uses the localhost callback when it can't register the custom scheme (AppImage, dev builds)
    let localhost_redirect_uri =
        (8065..=8070).map(|port| format!("http://localhost:{port}")).find(|uri| uri == raw_redirect_uri);

    // The redirect_uri sent to the IdP is always the server's oidc-signin endpoint.
    // The client's redirect_uri is stored and used after the IdP callback.
    let idp_redirect_uri = format!("{}/identity/connect/oidc-signin", CONFIG.domain());

    let client_redirect_uri = match client_id {
        "web" | "browser" => format!("{}/sso-connector.html", CONFIG.domain()),
        "desktop" => localhost_redirect_uri.unwrap_or_else(|| "vowkey://sso-callback".to_owned()),
        "mobile" => "vowkey://sso-callback".to_owned(),
        "cli" => {
            let Some(uri) = localhost_redirect_uri else {
                err!(format!("Unsupported redirect uri {}", raw_redirect_uri.escape_debug()))
            };
            uri
        }
        _ => err!(format!("Unsupported client {}", client_id.escape_debug())),
    };

    let (auth_url, mut sso_auth) =
        Client::authorize_url(provider, state, client_challenge, idp_redirect_uri, binding_hash, connector).await?;
    // Store the client's redirect_uri so oidcsignin_redirect can send the user there after the IdP callback.
    sso_auth.redirect_uri = client_redirect_uri;
    sso_auth.save(&conn).await?;
    Ok(auth_url)
}

#[derive(
    Clone,
    Debug,
    Default,
    DieselNewType,
    FromForm,
    PartialEq,
    Eq,
    Hash,
    Serialize,
    Deserialize,
    AsRef,
    Deref,
    Display,
    From,
)]
#[deref(forward)]
#[from(forward)]
pub struct OIDCIdentifier(String);

impl OIDCIdentifier {
    pub fn new(issuer: &str, subject: &str) -> Self {
        OIDCIdentifier(format!("{issuer}/{subject}"))
    }
}

// During the 2FA flow we will
//  - retrieve the user information and then only discover he needs 2FA.
//  - second time we will rely on `SsoAuth.auth_response` since the `code` has already been exchanged,
//    after checking the PKCE verifier again like upstream does on every redemption.
// The `SsoAuth` will ensure that the user is authorized only once.
pub async fn exchange_code(
    code: &OIDCCode,
    client_verifier: OIDCCodeVerifier,
    conn: &DbConn,
) -> ApiResult<(SsoAuth, OIDCAuthenticatedUser)> {
    use openidconnect::OAuth2TokenResponse;

    let Some(mut sso_auth) = SsoAuth::find_by_code(code, conn).await else {
        err!("Invalid code cannot retrieve sso auth")
    };

    if let Some(authenticated_user) = sso_auth.auth_response.clone() {
        Client::check_client_verifier(&client_verifier, &sso_auth)?;
        return Ok((sso_auth, authenticated_user));
    }

    let code = match (sso_auth.code_response.clone(), sso_auth.code_response_error.as_ref()) {
        (Some(code), None) => code,
        (_, Some(re)) => {
            let error_msg = format!(
                "SSO authorization failed: {}, {}",
                re.error,
                re.error_description.as_ref().unwrap_or(&String::new())
            );
            sso_auth.delete(conn).await?;
            err!(error_msg);
        }
        (None, _) => {
            sso_auth.delete(conn).await?;
            err!("Missing authorization provider return");
        }
    };

    let provider = SsoProvider::from_state(&sso_auth.state);
    let saved_apple_email = sso_auth.nonce.rsplit_once("|apple-email=").map(|(_, email)| email.to_owned());
    sso_auth.nonce = sso_auth.nonce.split_once("|apple-email=").map(|(nonce, _)| nonce.to_owned()).unwrap_or_else(|| sso_auth.nonce.clone());
    let client = Client::cached_for(provider).await?;
    let (token_response, id_claims) = client.exchange_code(provider, code, client_verifier, &sso_auth).await?;

    let user_info = if client.core_client.user_info_url().is_some() {
        Some(client.user_info(token_response.access_token().to_owned()).await?)
    } else {
        None
    };

    let email = match id_claims.email().or_else(|| user_info.as_ref().and_then(|info| info.email()))
        .map(|email| email.to_string()).or(saved_apple_email) {
        None => err!("Neither id token nor userinfo contained an email"),
        Some(e) => e.to_lowercase(),
    };
    if provider == SsoProvider::Apple && SsoUser::find_by_identifier(&OIDCIdentifier::new(id_claims.issuer(), id_claims.subject()), conn).await.is_none()
        && User::find_by_mail(&email, conn).await.is_some() {
        err!("An account with this email already exists. Sign in with its password before linking Apple.");
    }

    let email_verified = id_claims.email_verified().or_else(|| user_info.as_ref().and_then(|info| info.email_verified()));

    let user_name = id_claims
        .preferred_username()
        .or_else(|| user_info.as_ref().and_then(|info| info.preferred_username()))
        .map(|un| un.to_string())
        .or_else(|| {
            id_claims
                .name()
                .or_else(|| user_info.as_ref().and_then(|info| info.name()))
                .and_then(|n| n.get(None))
                .map(|n| n.as_str().to_owned())
        });

    let refresh_token = token_response.refresh_token().map(openidconnect::RefreshToken::secret);
    if provider == SsoProvider::Enterprise
        && refresh_token.is_none()
        && CONFIG.sso_scopes_vec().contains(&"offline_access".to_owned())
    {
        error!("Scope offline_access is present but response contain no refresh_token");
    }

    let identifier = OIDCIdentifier::new(id_claims.issuer(), id_claims.subject());

    let authenticated_user = OIDCAuthenticatedUser {
        refresh_token: refresh_token.cloned(),
        access_token: token_response.access_token().secret().clone(),
        expires_in: token_response.expires_in(),
        identifier: identifier.clone(),
        email: email.clone(),
        email_verified,
        user_name: user_name.clone(),
    };

    sso_auth.auth_response = Some(authenticated_user.clone());
    sso_auth.updated_at = Utc::now().naive_utc();
    sso_auth.save(conn).await?;

    Ok((sso_auth, authenticated_user))
}

// User has passed 2FA flow we can delete auth info from database
pub async fn redeem(
    provider: SsoProvider,
    device: &Device,
    user: &User,
    client_id: Option<String>,
    sso_user: Option<SsoUser>,
    sso_auth: SsoAuth,
    auth_user: OIDCAuthenticatedUser,
    conn: &DbConn,
) -> ApiResult<AuthTokens> {
    sso_auth.delete(conn).await?;

    if sso_user.is_none() {
        let user_sso = SsoUser {
            user_uuid: user.uuid.clone(),
            identifier: auth_user.identifier.clone(),
        };
        user_sso.save(conn).await?;
    }

    if provider == SsoProvider::Google || provider == SsoProvider::Apple || CONFIG.sso_auth_only_not_session() {
        Ok(AuthTokens::new_for_user(device, user, AuthMethod::Sso, client_id, conn).await?)
    } else {
        let now = Utc::now();

        let (ap_nbf, ap_exp) =
            match (decode_token_claims("access_token", &auth_user.access_token), auth_user.expires_in) {
                (Ok(ap), _) => (ap.nbf(), ap.exp),
                (Err(_), Some(exp)) => (now.timestamp(), (now + exp).timestamp()),
                _ => err!("Non jwt access_token and empty expires_in"),
            };

        let sub_info = Subscription::effective_for_user(&user.uuid, conn).await?;
        let access_claims =
            auth::LoginJwtClaims::new(device, user, ap_nbf, ap_exp, AuthMethod::Sso.scope_vec(), client_id, now)
                .with_plan(sub_info.effective_plan_code(), sub_info.decision_per_day);

        create_auth_tokens_impl(device, auth_user.refresh_token, access_claims, auth_user.access_token)
    }
}

// We always return a refresh_token (with no refresh_token some secrets are not displayed in the web front).
// If there is no SSO refresh_token, we keep the access_token to be able to call user_info to check for validity
pub async fn create_auth_tokens(
    device: &Device,
    user: &User,
    client_id: Option<String>,
    refresh_token: Option<String>,
    access_token: String,
    expires_in: Option<Duration>,
    conn: &DbConn,
) -> ApiResult<AuthTokens> {
    if CONFIG.sso_auth_only_not_session() {
        Ok(AuthTokens::new_for_user(device, user, AuthMethod::Sso, client_id, conn).await?)
    } else {
        let now = Utc::now();

        let (ap_nbf, ap_exp) = match (decode_token_claims("access_token", &access_token), expires_in) {
            (Ok(ap), _) => (ap.nbf(), ap.exp),
            (Err(_), Some(exp)) => (now.timestamp(), (now + exp).timestamp()),
            _ => err!("Non jwt access_token and empty expires_in"),
        };

        let sub_info = Subscription::effective_for_user(&user.uuid, conn).await?;
        let access_claims =
            auth::LoginJwtClaims::new(device, user, ap_nbf, ap_exp, AuthMethod::Sso.scope_vec(), client_id, now)
                .with_plan(sub_info.effective_plan_code(), sub_info.decision_per_day);

        create_auth_tokens_impl(device, refresh_token, access_claims, access_token)
    }
}

fn create_auth_tokens_impl(
    device: &Device,
    refresh_token: Option<String>,
    access_claims: auth::LoginJwtClaims,
    access_token: String,
) -> ApiResult<AuthTokens> {
    let (nbf, exp, token) = if let Some(rt) = refresh_token {
        match decode_token_claims("refresh_token", &rt) {
            Err(_) => {
                let time_now = Utc::now();
                let exp = (time_now + *DEFAULT_REFRESH_VALIDITY).timestamp();
                debug!("Non jwt refresh_token (expiration set to {exp})");
                (time_now.timestamp(), exp, TokenWrapper::Refresh(rt))
            }
            Ok(refresh_payload) => {
                debug!("Refresh_payload: {refresh_payload:?}");
                (refresh_payload.nbf(), refresh_payload.exp, TokenWrapper::Refresh(rt))
            }
        }
    } else {
        debug!("No refresh_token present");
        (access_claims.nbf, access_claims.exp, TokenWrapper::Access(access_token))
    };

    let refresh_claims = auth::RefreshJwtClaims {
        nbf,
        exp,
        iss: auth::JWT_LOGIN_ISSUER.to_string(),
        sub: AuthMethod::Sso,
        device_token: device.refresh_token.clone(),
        token: Some(token),
    };

    Ok(AuthTokens {
        refresh_claims,
        access_claims,
    })
}

// This endpoint is called in two case
//  - the session is close to expiration we will try to extend it
//  - the user is going to make an action and we check that the session is still valid
pub async fn exchange_refresh_token(
    device: &Device,
    user: &User,
    client_id: Option<String>,
    refresh_claims: auth::RefreshJwtClaims,
    conn: &DbConn,
) -> ApiResult<AuthTokens> {
    let exp = refresh_claims.exp;
    match refresh_claims.token {
        Some(TokenWrapper::Refresh(refresh_token)) => {
            // Use new refresh_token if returned
            let (new_refresh_token, access_token, expires_in) =
                Client::exchange_refresh_token(refresh_token.clone()).await?;

            create_auth_tokens(
                device,
                user,
                client_id,
                new_refresh_token.or(Some(refresh_token)),
                access_token,
                expires_in,
                conn,
            )
            .await
        }
        Some(TokenWrapper::Access(access_token)) => {
            let now = Utc::now();
            let exp_limit = (now + *BW_EXPIRATION).timestamp();

            if exp < exp_limit {
                err_silent!("Access token is close to expiration but we have no refresh token")
            }

            Client::check_validity(access_token.clone()).await?;

            let sub_info = Subscription::effective_for_user(&user.uuid, conn).await?;
            let access_claims = auth::LoginJwtClaims::new(
                device,
                user,
                now.timestamp(),
                exp,
                AuthMethod::Sso.scope_vec(),
                client_id,
                now,
            )
            .with_plan(sub_info.effective_plan_code(), sub_info.decision_per_day);

            create_auth_tokens_impl(device, None, access_claims, access_token)
        }
        None => err!("No token present while in SSO"),
    }
}

#[derive(Debug, Deserialize)]
pub struct AppleIdentity {
    pub email: String,
    pub sub: String,
}

pub async fn verify_apple_identity_token(token: &str, nonce: &str) -> Result<AppleIdentity, Error> {
    let header = jsonwebtoken::decode_header(token)?;
    let kid = header.kid.ok_or_else(|| Error::new_msg("Apple identity token has no key id"))?;
    let jwk = apple_key(&kid).await?;
    let mut validation = jsonwebtoken::Validation::new(jsonwebtoken::Algorithm::RS256);
    validation.set_issuer(&["https://appleid.apple.com"]);
    let mut audiences = vec![CONFIG.apple_client_id()];
    if !CONFIG.apple_native_client_id().is_empty() {
        audiences.push(CONFIG.apple_native_client_id());
    }
    validation.set_audience(&audiences);
    let claims: serde_json::Value = jsonwebtoken::decode(token, &jwk, &validation)?.claims;
    let token_nonce = claims.get("nonce").and_then(serde_json::Value::as_str).unwrap_or("");
    if nonce.is_empty() || !crypto::ct_eq(token_nonce, nonce) {
        err!("Apple sign-in nonce did not match");
    }
    let email = claims.get("email").and_then(serde_json::Value::as_str).unwrap_or("").to_lowercase();
    let verified = claims.get("email_verified").is_some_and(|value| value.as_bool() == Some(true) || value.as_str() == Some("true"));
    if !verified || !email.contains('@') {
        err!("Apple sign-in did not include a verified email");
    }
    Ok(AppleIdentity { email, sub: claims.get("sub").and_then(serde_json::Value::as_str).unwrap_or("").to_owned() })
}

async fn apple_key(kid: &str) -> Result<jsonwebtoken::DecodingKey, Error> {
    let response = crate::http_client::make_http_request(reqwest::Method::GET, "https://appleid.apple.com/auth/keys")?.send().await?.text().await?;
    let keys: serde_json::Value = serde_json::from_str(&response)?;
    let key = keys.get("keys").and_then(serde_json::Value::as_array).into_iter().flatten()
        .find(|key| key.get("kid").and_then(serde_json::Value::as_str) == Some(kid))
        .ok_or_else(Error::empty)?;
    Ok(jsonwebtoken::DecodingKey::from_rsa_components(
        key.get("n").and_then(serde_json::Value::as_str).unwrap_or(""),
        key.get("e").and_then(serde_json::Value::as_str).unwrap_or(""),
    )?)
}
