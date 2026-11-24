use std::{borrow::Cow, collections::HashSet, future::Future, pin::Pin, sync::LazyLock, time::Duration};

use openidconnect::{
    AccessToken, AsyncHttpClient, AuthDisplay, AuthPrompt, AuthType, AuthenticationFlow, AuthorizationCode,
    AuthorizationRequest, ClientId, ClientSecret, CsrfToken, EmptyAdditionalClaims, EmptyExtraTokenFields,
    EndpointMaybeSet, EndpointNotSet, EndpointSet, HttpClientError, HttpRequest, HttpResponse, IdTokenClaims, IdTokenFields, Nonce,
    OAuth2TokenResponse, PkceCodeChallenge, PkceCodeVerifier, RefreshToken, ResponseType, Scope, StandardErrorResponse,
    StandardTokenResponse,
    core::{
        CoreAuthDisplay, CoreAuthPrompt, CoreClient, CoreClientAuthMethod, CoreErrorResponseType, CoreGenderClaim,
        CoreIdTokenVerifier, CoreJsonWebKey, CoreJweContentEncryptionAlgorithm, CoreJwsSigningAlgorithm,
        CoreProviderMetadata, CoreResponseType, CoreRevocableToken, CoreRevocationErrorResponse,
        CoreTokenIntrospectionResponse, CoreTokenResponse, CoreTokenType, CoreUserInfoClaims,
    },
    http, url,
};
use regex::Regex;
use url::Url;

use crate::{
    CONFIG, Error,
    api::{ApiResult, EmptyResult},
    db::models::SsoAuth,
    http_client::get_reqwest_client_builder,
    sso::{OIDCCode, OIDCCodeChallenge, OIDCCodeVerifier, OIDCState, SsoProvider},
};

static CLIENT_CACHE: LazyLock<moka::sync::Cache<String, Client>> = LazyLock::new(|| {
    moka::sync::Cache::builder()
        .max_capacity(4)
        .time_to_live(Duration::from_secs(u64::from(CONFIG.sso_client_cache_expiration())))
        .build()
});
static REFRESH_CACHE: LazyLock<moka::future::Cache<String, Result<RefreshTokenResponse, String>>> =
    LazyLock::new(|| moka::future::Cache::builder().max_capacity(1000).time_to_live(Duration::from_secs(30)).build());

/// OpenID Connect Core client.
pub type CustomClient = openidconnect::Client<
    EmptyAdditionalClaims,
    CoreAuthDisplay,
    CoreGenderClaim,
    CoreJweContentEncryptionAlgorithm,
    CoreJsonWebKey,
    CoreAuthPrompt,
    StandardErrorResponse<CoreErrorResponseType>,
    CoreTokenResponse,
    CoreTokenIntrospectionResponse,
    CoreRevocableToken,
    CoreRevocationErrorResponse,
    EndpointSet,
    EndpointNotSet,
    EndpointNotSet,
    EndpointNotSet,
    EndpointSet,
    EndpointMaybeSet,
>;

pub type RefreshTokenResponse = (Option<String>, String, Option<Duration>);

#[derive(Clone)]
pub struct Client {
    pub http_client: OidcHttpClient,
    pub core_client: CustomClient,
}

#[derive(Clone)]
pub struct OidcHttpClient {
    client: reqwest::Client,
}

impl OidcHttpClient {
    fn new() -> Result<Self, reqwest::Error> {
        get_reqwest_client_builder(false).redirect(reqwest::redirect::Policy::none()).build().map(|client| Self {
            client,
        })
    }
}

impl<'c> AsyncHttpClient<'c> for OidcHttpClient {
    type Error = HttpClientError<reqwest::Error>;
    type Future = Pin<Box<dyn Future<Output = Result<HttpResponse, Self::Error>> + Send + Sync + 'c>>;

    fn call(&'c self, request: HttpRequest) -> Self::Future {
        Box::pin(async move {
            let response = self.client.execute(request.try_into().map_err(Box::new)?).await.map_err(|e| {
                debug!("Request failed {e:?}");
                Box::new(e)
            })?;

            let mut builder = http::Response::builder().status(response.status()).version(response.version());

            for (name, value) in response.headers() {
                builder = builder.header(name, value);
            }

            let body = response.bytes().await.map_err(Box::new)?;
            if CONFIG.sso_debug_tokens() {
                debug!("Response body {}", String::from_utf8_lossy(&body));
            }
            builder.body(body.to_vec()).map_err(HttpClientError::Http)
        })
    }
}

impl Client {
    fn cache_key(provider: SsoProvider) -> String {
        match provider {
            SsoProvider::Enterprise => "sso-client".to_owned(),
            SsoProvider::Google => format!("google:{}:{}", CONFIG.google_issuer_url(), CONFIG.google_client_id()),
            SsoProvider::Apple => format!("apple:{}", CONFIG.apple_client_id()),
        }
    }

    // Call the OpenId discovery endpoint to retrieve configuration
    async fn get_client(provider: SsoProvider) -> ApiResult<Self> {
        let (client_id, client_secret, issuer_url) = match provider {
            SsoProvider::Enterprise => (
                ClientId::new(CONFIG.sso_client_id()),
                ClientSecret::new(CONFIG.sso_client_secret()),
                CONFIG.sso_issuer_url()?,
            ),
            SsoProvider::Google => (
                ClientId::new(CONFIG.google_client_id()),
                ClientSecret::new(CONFIG.google_client_secret()),
                CONFIG.google_oidc_issuer_url()?,
            ),
            SsoProvider::Apple => (
                ClientId::new(CONFIG.apple_client_id()),
                ClientSecret::new(apple_client_secret()?),
                openidconnect::IssuerUrl::new("https://appleid.apple.com".to_owned()).map_err(|err| Error::new_msg(err.to_string()))?,
            ),
        };

        let http_client = match OidcHttpClient::new() {
            Err(err) => err!(format!("Failed to build http client: {err}")),
            Ok(client) => client,
        };

        let provider_metadata = match CoreProviderMetadata::discover_async(issuer_url, &http_client).await {
            Err(err) => err!(format!("Failed to discover OpenID provider: {err}")),
            Ok(metadata) => metadata,
        };

        let auth_methods: Option<HashSet<CoreClientAuthMethod>> = provider_metadata
            .token_endpoint_auth_methods_supported()
            .map(|v| v.iter().map(ToOwned::to_owned).collect());

        let mut base_client = CoreClient::from_provider_metadata(provider_metadata, client_id, Some(client_secret));

        if let Some(am) = auth_methods {
            if am.contains(&CoreClientAuthMethod::ClientSecretBasic) {
                base_client = base_client.set_auth_type(AuthType::BasicAuth); // Default
            } else if am.contains(&CoreClientAuthMethod::ClientSecretPost) {
                base_client = base_client.set_auth_type(AuthType::RequestBody);
            } else {
                err!(format!("No supported auth_methods (only basic or request body), advertised: {am:?}"));
            }
        }

        let token_uri = if let Some(uri) = base_client.token_uri() {
            uri.clone()
        } else {
            err!("Failed to discover token_url, cannot proceed")
        };

        let core_client = base_client
            .set_redirect_uri(CONFIG.sso_redirect_url()?)
            .set_token_uri(token_uri);

        Ok(Client {
            http_client,
            core_client,
        })
    }

    // Simple cache to prevent recalling the discovery endpoint each time
    pub async fn cached_for(provider: SsoProvider) -> ApiResult<Self> {
        let key = Self::cache_key(provider);
        if CONFIG.sso_client_cache_expiration() > 0 {
            match CLIENT_CACHE.get(&key) {
                Some(client) => Ok(client),
                None => Self::get_client(provider).await.inspect(|client| {
                    debug!("Inserting new client in cache");
                    CLIENT_CACHE.insert(key, client.clone());
                }),
            }
        } else {
            Self::get_client(provider).await
        }
    }

    pub async fn cached() -> ApiResult<Self> {
        Self::cached_for(SsoProvider::Enterprise).await
    }

    pub fn invalidate() {
        if CONFIG.sso_client_cache_expiration() > 0 {
            CLIENT_CACHE.invalidate_all();
        }
    }

    // The `state` is encoded using base64 to ensure no issue with providers (It contains the Organization identifier).
    pub async fn authorize_url(
        provider: SsoProvider,
        state: OIDCState,
        client_challenge: OIDCCodeChallenge,
        redirect_uri: String,
        binding_hash: Option<String>,
        connector: Option<&str>,
    ) -> ApiResult<(Url, SsoAuth)> {
        let scopes: Vec<Scope> = match provider {
            SsoProvider::Google => vec![Scope::new("email".to_owned()), Scope::new("profile".to_owned())],
            SsoProvider::Apple => vec![Scope::new("email".to_owned()), Scope::new("name".to_owned())],
            SsoProvider::Enterprise => CONFIG.sso_scopes_vec().into_iter().map(Scope::new).collect(),
        };
        let base64_state = data_encoding::BASE64.encode(state.to_string().as_bytes());

        let client = Self::cached_for(provider).await?;
        let mut auth_req = client
            .core_client
            .authorize_url(
                AuthenticationFlow::<CoreResponseType>::AuthorizationCode,
                || CsrfToken::new(base64_state),
                Nonce::new_random,
            )
            .add_scopes(scopes);

        if provider == SsoProvider::Enterprise {
            auth_req = auth_req.add_extra_params(CONFIG.sso_authorize_extra_params_vec());
            if let Some(connector) = connector {
                auth_req = auth_req.add_extra_param("connector_id", connector);
            }
        }
        if provider == SsoProvider::Apple {
            auth_req = auth_req.add_extra_param("response_mode", "form_post");
        }

        if provider == SsoProvider::Google || (provider == SsoProvider::Enterprise && CONFIG.sso_pkce()) {
            auth_req = auth_req
                .add_extra_param::<&str, String>("code_challenge", client_challenge.clone().into())
                .add_extra_param("code_challenge_method", "S256");
        }

        let (auth_url, _, nonce) = auth_req.url();
        Ok((auth_url, SsoAuth::new(state, client_challenge, nonce.secret().clone(), redirect_uri, binding_hash)))
    }

    // Check the client's PKCE verifier against the challenge it sent when starting the flow
    pub fn check_client_verifier(client_verifier: &OIDCCodeVerifier, sso_auth: &SsoAuth) -> EmptyResult {
        let verifier = PkceCodeVerifier::new(client_verifier.to_string());
        let challenge = PkceCodeChallenge::from_code_verifier_sha256(&verifier);
        if challenge.as_str() != &*sso_auth.client_challenge {
            err!("PKCE client challenge failed")
        }
        Ok(())
    }

    pub async fn exchange_code(
        &self,
        provider: SsoProvider,
        code: OIDCCode,
        client_verifier: OIDCCodeVerifier,
        sso_auth: &SsoAuth,
    ) -> ApiResult<(
        StandardTokenResponse<
            IdTokenFields<
                EmptyAdditionalClaims,
                EmptyExtraTokenFields,
                CoreGenderClaim,
                CoreJweContentEncryptionAlgorithm,
                CoreJwsSigningAlgorithm,
            >,
            CoreTokenType,
        >,
        IdTokenClaims<EmptyAdditionalClaims, CoreGenderClaim>,
    )> {
        Self::check_client_verifier(&client_verifier, sso_auth)?;
        let oidc_code = AuthorizationCode::new(code.to_string());

        let client = if provider == SsoProvider::Apple {
            Cow::Owned(self.core_client.clone().set_client_secret(ClientSecret::new(apple_client_secret()?)))
        } else {
            Cow::Borrowed(&self.core_client)
        };
        let mut exchange = client.exchange_code(oidc_code);

        if provider == SsoProvider::Google || (provider == SsoProvider::Enterprise && CONFIG.sso_pkce()) {
            exchange = exchange.set_pkce_verifier(PkceCodeVerifier::new(client_verifier.into()));
        }

        match exchange.request_async(&self.http_client).await {
            Err(err) => err!(format!("Failed to contact token endpoint: {:?}", err)),
            Ok(token_response) => {
                let oidc_nonce = Nonce::new(sso_auth.nonce.clone());

                let Some(id_token) = token_response.extra_fields().id_token() else {
                    err!("Token response did not contain an id_token")
                };

                if CONFIG.sso_debug_tokens() {
                    debug!("Id token: {}", id_token.to_string());
                    debug!("Access token: {}", token_response.access_token().secret());
                    debug!("Refresh token: {:?}", token_response.refresh_token().map(RefreshToken::secret));
                    debug!("Expiration time: {:?}", token_response.expires_in());
                }

                let id_claims = match id_token.claims(&self.vw_id_token_verifier(), &oidc_nonce) {
                    Ok(claims) => claims.clone(),
                    Err(err) => {
                        Self::invalidate();
                        err!(format!("Could not read id_token claims, {err}"));
                    }
                };

                Ok((token_response, id_claims))
            }
        }
    }

    pub async fn user_info(&self, access_token: AccessToken) -> ApiResult<CoreUserInfoClaims> {
        let request = self.core_client.user_info(access_token, None)
            .map_err(|error| Error::new_msg(format!("User info endpoint is unavailable: {error}")))?;
        match request.request_async(&self.http_client).await {
            Err(err) => err!(format!("Request to user_info endpoint failed: {err}")),
            Ok(user_info) => Ok(user_info),
        }
    }

    pub async fn check_validity(access_token: String) -> EmptyResult {
        let client = Client::cached().await?;
        match client.user_info(AccessToken::new(access_token)).await {
            Err(err) => {
                err_silent!(format!("Failed to retrieve user info, token has probably been invalidated: {err}"))
            }
            Ok(_) => Ok(()),
        }
    }

    pub fn vw_id_token_verifier(&self) -> CoreIdTokenVerifier<'_> {
        let mut verifier = self.core_client.id_token_verifier();
        if let Some(regex_str) = CONFIG.sso_audience_trusted() {
            match Regex::new(&regex_str) {
                Ok(regex) => {
                    verifier = verifier.set_other_audience_verifier_fn(move |aud| regex.is_match(aud));
                }
                Err(err) => {
                    error!("Failed to parse SSO_AUDIENCE_TRUSTED={regex_str} regex: {err}");
                }
            }
        }
        verifier
    }

    pub async fn exchange_refresh_token(refresh_token: String) -> ApiResult<RefreshTokenResponse> {
        let client = Client::cached().await?;

        REFRESH_CACHE
            .get_with(refresh_token.clone(), async move { client.exchange_refresh_token_impl(refresh_token).await })
            .await
            .map_err(Into::into)
    }

    async fn exchange_refresh_token_impl(&self, refresh_token: String) -> Result<RefreshTokenResponse, String> {
        let rt = RefreshToken::new(refresh_token);

        match self.core_client.exchange_refresh_token(&rt).request_async(&self.http_client).await {
            Err(err) => {
                error!("Request to exchange_refresh_token endpoint failed: {err}");
                Err(format!("Request to exchange_refresh_token endpoint failed: {err}"))
            }
            Ok(token_response) => Ok((
                token_response.refresh_token().map(|token| token.secret().clone()),
                token_response.access_token().secret().clone(),
                token_response.expires_in(),
            )),
        }
    }
}

trait AuthorizationRequestExt<'a> {
    fn add_extra_params<N: Into<Cow<'a, str>>, V: Into<Cow<'a, str>>>(self, params: Vec<(N, V)>) -> Self;
}

impl<'a, AD: AuthDisplay, P: AuthPrompt, RT: ResponseType> AuthorizationRequestExt<'a>
    for AuthorizationRequest<'a, AD, P, RT>
{
    fn add_extra_params<N: Into<Cow<'a, str>>, V: Into<Cow<'a, str>>>(mut self, params: Vec<(N, V)>) -> Self {
        for (key, value) in params {
            self = self.add_extra_param(key, value);
        }
        self
    }
}

pub fn apple_client_secret() -> Result<String, Error> {
    sign_apple_client_secret(CONFIG.apple_private_key().as_bytes(), &CONFIG.apple_team_id(),
        &CONFIG.apple_client_id(), &CONFIG.apple_key_id(), chrono::Utc::now().timestamp())
}

fn sign_apple_client_secret(private_key: &[u8], team: &str, client: &str, key_id: &str, now: i64) -> Result<String, Error> {
    let key = jsonwebtoken::EncodingKey::from_ec_pem(private_key)?;
    let claims = serde_json::json!({
        "iss": team,
        "sub": client,
        "aud": "https://appleid.apple.com",
        "iat": now,
        "exp": now + 300,
    });
    let header = jsonwebtoken::Header {
        alg: jsonwebtoken::Algorithm::ES256,
        kid: Some(key_id.to_owned()),
        ..Default::default()
    };
    Ok(jsonwebtoken::encode(&header, &claims, &key)?)
}

#[cfg(test)]
mod tests {
    #[test]
    fn apple_client_secret_is_an_es256_jwt_for_this_service() {
        let key = openssl::ec::EcKey::generate(openssl::ec::EcGroup::from_curve_name(openssl::nid::Nid::X9_62_PRIME256V1).unwrap().as_ref()).unwrap();
        let key = openssl::pkey::PKey::from_ec_key(key).unwrap();
        let pem = key.private_key_to_pem_pkcs8().unwrap();
        let token = super::sign_apple_client_secret(&pem, "TEAM", "com.vowkey.app", "KEY", chrono::Utc::now().timestamp()).unwrap();
        let mut validation = jsonwebtoken::Validation::new(jsonwebtoken::Algorithm::ES256);
        validation.set_audience(&["https://appleid.apple.com"]);
        validation.set_issuer(&["TEAM"]);
        let decoded: serde_json::Value = jsonwebtoken::decode(&token, &jsonwebtoken::DecodingKey::from_ec_pem(&key.public_key_to_pem().unwrap()).unwrap(), &validation).unwrap().claims;
        assert_eq!(decoded["sub"], "com.vowkey.app");
        assert_eq!(decoded["exp"].as_i64().unwrap() - decoded["iat"].as_i64().unwrap(), 300);
        assert_eq!(jsonwebtoken::decode_header(&token).unwrap().kid.unwrap(), "KEY");
    }
}
