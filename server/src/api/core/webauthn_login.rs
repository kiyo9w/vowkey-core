use std::{sync::LazyLock, time::Duration};

use data_encoding::BASE64URL_NOPAD;
use rocket::{Route, serde::json::Json};
use serde_json::Value;
use url::Url;
use uuid::Uuid;
use webauthn_rs::prelude::{Credential, Passkey};
use webauthn_rs_core::WebauthnCore;
use webauthn_rs_core::proto::AuthenticationState;
use webauthn_rs_proto::{
    PublicKeyCredential,
    RegisterPublicKeyCredential, RequestAuthenticationExtensions, UserVerificationPolicy,
};

use crate::{
    CONFIG,
    api::{EmptyResult, JsonResult, PasswordOrOtpData},
    auth::{self, AuthMethod, ClientIp, Headers},
    crypto,
    db::DbConn,
    db::models::{Device, EventType, User, UserId},
    error::Error,
};

const MAX_CREDENTIALS: usize = 5;
const CHALLENGE_MINUTES: i64 = 17;
const SCOPE_AUTHENTICATION: &str = "authentication";
const SCOPE_UPDATE: &str = "update";

static WEBAUTHN: LazyLock<WebauthnCore> = LazyLock::new(|| {
    let domain = CONFIG.domain();
    let rp_id = Url::parse(&domain).ok().and_then(|u| u.domain().map(str::to_owned)).unwrap_or_default();
    let rp_origin = Url::parse(&CONFIG.domain_origin()).expect("DOMAIN_ORIGIN is a URL");
    WebauthnCore::new_unsafe_experts_only("Vowkey", &rp_id, vec![rp_origin], Duration::from_mins(5), None, None)
});

#[derive(Clone, Debug, Serialize, Deserialize)]
struct ChallengeToken {
    nbf: i64,
    exp: i64,
    iss: String,
    scope: String,
    user: Option<UserId>,
    challenge: String,
    state: Value,
}

fn challenge_issuer() -> String {
    format!("{}|webauthn-challenge", CONFIG.domain_origin())
}

fn seal(scope: &str, user: Option<UserId>, state: &impl serde::Serialize) -> Result<(String, String), Error> {
    let challenge = BASE64URL_NOPAD.encode(&crypto::get_random_bytes::<32>());
    let now = chrono::Utc::now().timestamp();
    let token = auth::encode_jwt(&ChallengeToken {
        nbf: now,
        exp: now + CHALLENGE_MINUTES * 60,
        iss: challenge_issuer(),
        scope: scope.to_owned(),
        user,
        challenge: challenge.clone(),
        state: serde_json::to_value(state)?,
    });
    Ok((token, challenge))
}

fn open(token: &str, scope: &str, user: Option<&UserId>) -> Result<ChallengeToken, Error> {
    let claims: ChallengeToken = auth::decode_jwt(token, challenge_issuer())?;
    if claims.scope != scope || claims.user.as_ref() != user {
        err!("The token associated with your request is invalid or has expired.");
    }
    Ok(claims)
}

async fn consume_challenge(challenge: &str, conn: &DbConn) -> EmptyResult {
    use diesel::prelude::*;
    let challenge = challenge.to_owned();
    let inserted = conn.run(move |connection| {
        diesel::insert_into(crate::db::schema::webauthn_challenges::table)
            .values((
                crate::db::schema::webauthn_challenges::challenge.eq(challenge),
                crate::db::schema::webauthn_challenges::consumed_at.eq(chrono::Utc::now().naive_utc()),
            ))
            .execute(connection)
    }).await;
    if inserted.ok().filter(|count| *count == 1).is_none() {
        err!("Invalid credential.");
    }
    Ok(())
}

fn credential_json(row: &WebauthnLoginCredential) -> Value {
    json!({
        "Id": row.uuid,
        "Name": row.name,
        "PrfStatus": row.prf_status(),
        "EncryptedUserKey": row.encrypted_user_key,
        "EncryptedPublicKey": row.encrypted_public_key,
        "Object": "webauthnCredential",
    })
}

pub fn creation_options(value: Value) -> Result<Value, Error> {
    let mut options = value;
    if let Some(public_key) = options.get_mut("publicKey") {
        options = public_key.take();
    }
    options["authenticatorSelection"]["residentKey"] = json!("required");
    options["authenticatorSelection"]["requireResidentKey"] = json!(true);
    options["authenticatorSelection"]["userVerification"] = json!("required");
    options["extensions"]["prf"] = json!({});
    Ok(options)
}

pub fn routes() -> Vec<Route> {
    routes![list_credentials, attestation_options, authenticated_assertion_options, save_credential, update_credential, delete_credential]
}

pub fn identity_routes() -> Vec<Route> {
    routes![assertion_options]
}

#[get("/webauthn")]
async fn list_credentials(headers: Headers, conn: DbConn) -> JsonResult {
    let rows = WebauthnLoginCredential::find_by_user(&headers.user.uuid, &conn).await;
    Ok(Json(json!({
        "object": "list",
        "data": rows.iter().map(credential_json).collect::<Vec<_>>(),
        "continuationToken": null,
    })))
}

#[post("/webauthn/attestation-options", data = "<data>")]
async fn attestation_options(data: Json<PasswordOrOtpData>, headers: Headers, conn: DbConn) -> JsonResult {
    let user = headers.user;
    data.into_inner().validate(&user, false, &conn).await?;
    let existing = WebauthnLoginCredential::find_by_user(&user.uuid, &conn).await;
    let exclude = existing.iter().filter_map(|row| row.passkey().ok().map(|key| key.cred_id().clone())).collect();
    let user_handle = Uuid::parse_str(&user.uuid).map_err(|_| Error::new_msg("Invalid account identifier"))?;
    let (challenge, state) = WEBAUTHN.generate_challenge_register(
        WEBAUTHN.new_challenge_register_builder(user_handle.as_bytes(), &user.email, user.display_name())?
            .exclude_credentials(Some(exclude)).require_resident_key(true)
            .user_verification_policy(UserVerificationPolicy::Required),
    )?;
    Ok(Json(json!({
        "options": creation_options(serde_json::to_value(&challenge)?)?,
        "token": seal("create", Some(user.uuid), &state)?.0,
        "object": "webauthnCredentialCreateOptions",
    })))
}

#[get("/accounts/webauthn/assertion-options")]
fn assertion_options() -> JsonResult {
    assertion_options_for(SCOPE_AUTHENTICATION, None)
}

#[post("/webauthn/assertion-options", data = "<data>")]
async fn authenticated_assertion_options(data: Json<PasswordOrOtpData>, headers: Headers, conn: DbConn) -> JsonResult {
    data.into_inner().validate(&headers.user, false, &conn).await?;
    assertion_options_for(SCOPE_UPDATE, Some(headers.user.uuid))
}

fn assertion_options_for(scope: &str, user: Option<UserId>) -> JsonResult {
    let builder = WEBAUTHN.new_challenge_authenticate_builder(Vec::new(), Some(UserVerificationPolicy::Required))?
        .extensions(Some(RequestAuthenticationExtensions { appid: None, uvm: None, hmac_get_secret: None }));
    let (challenge, state) = WEBAUTHN.generate_challenge_authenticate(builder)?;
    let mut options = serde_json::to_value(challenge.public_key)?;
    options["extensions"] = json!({ "prf": { "eval": { "first": BASE64URL_NOPAD.encode(&crypto::get_random_bytes::<32>()) } } });
    Ok(Json(json!({ "options": options, "token": seal(scope, user, &state)?.0, "object": "webAuthnLoginAssertionOptions" })))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveCredential {
    device_response: RegisterPublicKeyCredential,
    name: String,
    token: String,
    supports_prf: bool,
    encrypted_user_key: Option<String>,
    encrypted_public_key: Option<String>,
    encrypted_private_key: Option<String>,
}

#[post("/webauthn", data = "<data>")]
async fn save_credential(data: Json<SaveCredential>, headers: Headers, conn: DbConn) -> JsonResult {
    let user = headers.user;
    let data = data.into_inner();
    if data.name.trim().is_empty() || data.name.chars().count() > 50 {
        err!("Unable to complete WebAuthn registration.");
    }
    let claims = open(&data.token, "create", Some(&user.uuid))?;
    let state: webauthn_rs_core::proto::RegistrationState = serde_json::from_value(claims.state)?;
    let existing = WebauthnLoginCredential::find_by_user(&user.uuid, &conn).await;
    if existing.len() >= MAX_CREDENTIALS {
        err!("Unable to complete WebAuthn registration.");
    }
    let passkey = Passkey::from(WEBAUTHN.register_credential(&data.device_response, &state, None)?);
    consume_challenge(&claims.challenge, &conn).await?;
    let credential_id = BASE64URL_NOPAD.encode(passkey.cred_id());
    if existing.iter().any(|row| row.credential_id == credential_id) {
        err!("Unable to complete WebAuthn registration.");
    }
    let row = WebauthnLoginCredential::new(
        user.uuid,
        data.name,
        credential_id,
        passkey,
        data.supports_prf,
        data.encrypted_user_key,
        data.encrypted_public_key,
        data.encrypted_private_key,
    );
    row.save(&conn).await?;
    Ok(Json(credential_json(&row)))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateCredential {
    device_response: PublicKeyCredential,
    token: String,
    encrypted_user_key: String,
    encrypted_public_key: String,
    encrypted_private_key: String,
}

#[put("/webauthn", data = "<data>")]
async fn update_credential(data: Json<UpdateCredential>, headers: Headers, conn: DbConn) -> EmptyResult {
    let data = data.into_inner();
    for key in [&data.encrypted_user_key, &data.encrypted_public_key, &data.encrypted_private_key] {
        if key.is_empty() || key.len() > 2000 {
            err!("Unable to update credential.");
        }
    }
    let claims = open(&data.token, SCOPE_UPDATE, Some(&headers.user.uuid))?;
    let mut row = verify_assertion(&data.device_response, &claims.state, &conn).await?;
    consume_challenge(&claims.challenge, &conn).await?;
    if !row.supports_prf || row.user_uuid != headers.user.uuid {
        err!("Unable to update credential.");
    }
    row.encrypted_user_key = Some(data.encrypted_user_key);
    row.encrypted_public_key = Some(data.encrypted_public_key);
    row.encrypted_private_key = Some(data.encrypted_private_key);
    row.save(&conn).await
}

#[post("/webauthn/<id>/delete", data = "<data>")]
async fn delete_credential(
    id: WebauthnLoginCredentialId,
    data: Json<PasswordOrOtpData>,
    headers: Headers,
    conn: DbConn,
) -> EmptyResult {
    data.into_inner().validate(&headers.user, false, &conn).await?;
    let Some(row) = WebauthnLoginCredential::find_by_uuid_and_user(&id, &headers.user.uuid, &conn).await else {
        err!("Credential not found.");
    };
    row.delete(&conn).await
}

pub struct VerifiedLogin {
    pub user: User,
    pub credential: WebauthnLoginCredential,
}

pub async fn verify_login(token: &str, device_response: &str, conn: &DbConn) -> Result<VerifiedLogin, Error> {
    let credential: PublicKeyCredential = serde_json::from_str(device_response).map_err(|_| Error::empty())?;
    let claims = open(token, SCOPE_AUTHENTICATION, None)?;
    let row = verify_assertion(&credential, &claims.state, conn).await?;
    consume_challenge(&claims.challenge, conn).await?;
    let Some(user) = User::find_by_uuid(&row.user_uuid, conn).await else { err!("Invalid credential.") };
    Ok(VerifiedLogin { user, credential: row })
}

async fn verify_assertion(
    credential: &PublicKeyCredential,
    state: &Value,
    conn: &DbConn,
) -> Result<WebauthnLoginCredential, Error> {
    let mut auth: AuthenticationState = serde_json::from_value(state.clone())?;
    let user_handle = credential.get_user_unique_id().ok_or_else(Error::empty)?;
    let user_uuid = UserId::from(Uuid::from_slice(user_handle).map_err(|_| Error::empty())?.to_string());
    let credential_id = BASE64URL_NOPAD.encode(credential.get_credential_id());
    let Some(mut row) = WebauthnLoginCredential::find_by_user(&user_uuid, conn)
        .await
        .into_iter()
        .find(|row| crypto::ct_eq(&row.credential_id, &credential_id))
    else {
        err!("Invalid credential.");
    };
    let mut passkey = row.passkey()?;
    auth.set_allowed_credentials(vec![Credential::from(passkey.clone())]);
    let verified = WEBAUTHN.authenticate_credential(credential, &auth)?;
    if passkey.update_credential(&verified) == Some(true) {
        row.passkey = serde_json::to_string(&passkey)?;
        row.save(conn).await?;
    }
    Ok(row)
}

pub async fn webauthn_login(
    data: crate::api::identity::ConnectData,
    user_id: &mut Option<UserId>,
    conn: &DbConn,
    ip: &ClientIp,
) -> JsonResult {
    AuthMethod::Password.check_scope(data.scope.as_ref())?;
    crate::ratelimit::check_limit_login(&ip.ip)?;
    let (Some(token), Some(device_response)) = (data.token.as_deref(), data.device_response.as_deref()) else {
        err!("Invalid grant");
    };
    let verified = verify_login(token, device_response, conn).await?;
    let user_uuid = verified.user.uuid.clone();
    *user_id = Some(user_uuid.clone());
    let mut device = get_or_create_device(&data, conn, &verified.user).await?;
    let mut user = verified.user;
    let twofactor_token = crate::api::identity::twofactor_auth(&mut user, &data, &mut device, ip, conn).await?;
    let tokens = auth::AuthTokens::new_for_user(&device, &user, AuthMethod::Password, data.client_id.clone(), conn).await?;
    let Json(mut response) = crate::api::identity::authenticated_response(&user, &mut device, tokens, twofactor_token, conn, ip).await?;
    if verified.credential.prf_status() == 0 {
        response["UserDecryptionOptions"]["WebAuthnPrfOption"] = json!({
            "EncryptedPrivateKey": verified.credential.encrypted_private_key,
            "EncryptedUserKey": verified.credential.encrypted_user_key,
            "CredentialId": verified.credential.credential_id,
            "Transports": [],
        });
    }
    crate::api::core::log_user_event(EventType::UserLoggedIn, &user_uuid, device.atype, &ip.ip, conn).await;
    Ok(Json(response))
}

async fn get_or_create_device(
    data: &crate::api::identity::ConnectData,
    conn: &DbConn,
    user: &User,
) -> Result<Device, Error> {
    let Some(identifier) = &data.device_identifier else { err!("device_identifier cannot be blank") };
    if let Some(device) = Device::find_by_uuid_and_user(identifier, &user.uuid, conn).await {
        return Ok(device);
    }
    let mut device = Device::new(
        identifier.clone(),
        user.uuid.clone(),
        data.device_name.clone().unwrap_or_else(|| "Unknown device".to_owned()),
        data.device_type.as_deref().and_then(|v| v.parse().ok()).unwrap_or(14),
    );
    device.save(false, conn).await?;
    Ok(device)
}

pub use model::{WebauthnLoginCredential, WebauthnLoginCredentialId};

mod model {
    use chrono::Utc;
    use derive_more::{AsRef, Deref, Display, From};
    use diesel::prelude::*;
    use rocket::form::FromForm;
    use serde::{Deserialize, Serialize};
    use webauthn_rs::prelude::Passkey;

    use crate::{api::EmptyResult, db::{DbConn, schema::webauthn_credentials}, db_run, error::MapResult, util::get_uuid};
    use macros::UuidFromParam;
    use super::UserId;
    #[derive(Clone, Debug, AsRef, Deref, DieselNewType, Display, From, FromForm, Hash, PartialEq, Eq, Serialize, Deserialize, UuidFromParam)]
    #[deref(forward)]
    pub struct WebauthnLoginCredentialId(String);

    #[derive(Clone, Identifiable, Queryable, Insertable, AsChangeset)]
    #[diesel(table_name = webauthn_credentials)]
    #[diesel(treat_none_as_null = true)]
    #[diesel(primary_key(uuid))]
    pub struct WebauthnLoginCredential {
        pub uuid: WebauthnLoginCredentialId,
        pub user_uuid: UserId,
        pub name: String,
        pub credential_id: String,
        pub supports_prf: bool,
        pub encrypted_user_key: Option<String>,
        pub encrypted_public_key: Option<String>,
        pub encrypted_private_key: Option<String>,
        pub passkey: String,
        pub created_at: chrono::NaiveDateTime,
    }

    impl WebauthnLoginCredential {
        pub fn new(
            user_uuid: UserId,
            name: String,
            credential_id: String,
            passkey: Passkey,
            supports_prf: bool,
            encrypted_user_key: Option<String>,
            encrypted_public_key: Option<String>,
            encrypted_private_key: Option<String>,
        ) -> Self {
            Self {
                uuid: WebauthnLoginCredentialId(get_uuid()),
                user_uuid,
                name,
                credential_id,
                supports_prf,
                encrypted_user_key,
                encrypted_public_key,
                encrypted_private_key,
                passkey: serde_json::to_string(&passkey).unwrap_or_default(),
                created_at: Utc::now().naive_utc(),
            }
        }

        pub fn prf_status(&self) -> i32 {
            if !self.supports_prf {
                2
            } else if self.encrypted_user_key.is_some() && self.encrypted_public_key.is_some() && self.encrypted_private_key.is_some() {
                0
            } else {
                1
            }
        }

        pub fn passkey(&self) -> Result<Passkey, crate::Error> {
            Ok(serde_json::from_str(&self.passkey)?)
        }

        pub async fn save(&self, conn: &DbConn) -> EmptyResult {
            db_run! { conn:
                sqlite, mysql {
                    diesel::replace_into(webauthn_credentials::table).values(self).execute(conn).map_res("Error saving webauthn credential")
                }
                postgresql {
                    diesel::insert_into(webauthn_credentials::table).values(self).on_conflict(webauthn_credentials::uuid).do_update().set(self).execute(conn).map_res("Error saving webauthn credential")
                }
            }
        }

        pub async fn delete(self, conn: &DbConn) -> EmptyResult {
            conn.run(move |conn| diesel::delete(webauthn_credentials::table.filter(webauthn_credentials::uuid.eq(self.uuid))).execute(conn).map_res("Error deleting webauthn credential")).await
        }

        pub async fn find_by_user(user_uuid: &UserId, conn: &DbConn) -> Vec<Self> {
            conn.run(move |conn| webauthn_credentials::table.filter(webauthn_credentials::user_uuid.eq(user_uuid)).load::<Self>(conn).unwrap_or_default()).await
        }

        pub async fn find_by_uuid_and_user(uuid: &WebauthnLoginCredentialId, user_uuid: &UserId, conn: &DbConn) -> Option<Self> {
            conn.run(move |conn| webauthn_credentials::table.filter(webauthn_credentials::uuid.eq(uuid)).filter(webauthn_credentials::user_uuid.eq(user_uuid)).first::<Self>(conn).ok()).await
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use webauthn_rs_core::proto::Base64UrlSafeData;
    use webauthn_rs_proto::{AuthenticationExtensionsClientOutputs, AuthenticatorAssertionResponseRaw, AuthenticatorAttestationResponseRaw, RegistrationExtensionsClientOutputs};

    struct SoftAuthenticator { key: openssl::ec::EcKey<openssl::pkey::Private>, credential_id: Vec<u8>, counter: u32 }
    impl SoftAuthenticator {
        fn new() -> Self {
            let group = openssl::ec::EcGroup::from_curve_name(openssl::nid::Nid::X9_62_PRIME256V1).unwrap();
            Self { key: openssl::ec::EcKey::generate(&group).unwrap(), credential_id: crypto::get_random_bytes::<16>().to_vec(), counter: 0 }
        }
        fn public_key(&self) -> Vec<u8> {
            let mut ctx = openssl::bn::BigNumContext::new().unwrap();
            let mut x = openssl::bn::BigNum::new().unwrap();
            let mut y = openssl::bn::BigNum::new().unwrap();
            self.key.public_key().affine_coordinates(self.key.group(), &mut x, &mut y, &mut ctx).unwrap();
            [vec![0xa5, 0x01, 0x02, 0x03, 0x26, 0x20, 0x01, 0x21, 0x58, 0x20], x.to_vec_padded(32).unwrap(), vec![0x22, 0x58, 0x20], y.to_vec_padded(32).unwrap()].concat()
        }
        fn auth_data(&mut self, rp_id: &str, attested: bool, verified: bool) -> Vec<u8> {
            self.counter += 1;
            let mut data = ring::digest::digest(&ring::digest::SHA256, rp_id.as_bytes()).as_ref().to_vec();
            data.push(0x01 | u8::from(verified) << 2 | u8::from(attested) << 6);
            data.extend(self.counter.to_be_bytes());
            if attested { data.extend([0u8; 16]); data.extend((self.credential_id.len() as u16).to_be_bytes()); data.extend(&self.credential_id); data.extend(self.public_key()); }
            data
        }
        fn sign(&self, auth_data: &[u8], client_data: &[u8]) -> Vec<u8> {
            let pkey = openssl::pkey::PKey::from_ec_key(self.key.clone()).unwrap();
            let mut signer = openssl::sign::Signer::new(openssl::hash::MessageDigest::sha256(), &pkey).unwrap();
            signer.update(&[auth_data, ring::digest::digest(&ring::digest::SHA256, client_data).as_ref()].concat()).unwrap();
            signer.sign_to_vec().unwrap()
        }
        fn register(&mut self, challenge: &str, origin: &str, rp_id: &str, verified: bool) -> RegisterPublicKeyCredential {
            let client_data = client_json("webauthn.create", challenge, origin);
            let auth_data = self.auth_data(rp_id, true, verified);
            RegisterPublicKeyCredential {
                id: BASE64URL_NOPAD.encode(&self.credential_id), raw_id: self.credential_id.clone().into(),
                response: AuthenticatorAttestationResponseRaw { attestation_object: none_attestation(&auth_data).into(), client_data_json: client_data.into(), transports: None },
                type_: "public-key".into(), extensions: RegistrationExtensionsClientOutputs::default(),
            }
        }
        fn assert(&mut self, challenge: &str, origin: &str, rp_id: &str, user: &Uuid) -> PublicKeyCredential {
            let client_data = client_json("webauthn.get", challenge, origin);
            let auth_data = self.auth_data(rp_id, false, true);
            PublicKeyCredential {
                id: BASE64URL_NOPAD.encode(&self.credential_id), raw_id: self.credential_id.clone().into(),
                response: AuthenticatorAssertionResponseRaw {
                    authenticator_data: auth_data.clone().into(), client_data_json: client_data.clone().into(),
                    signature: self.sign(&auth_data, &client_data).into(), user_handle: Some(user.as_bytes().to_vec().into()),
                },
                extensions: AuthenticationExtensionsClientOutputs::default(), type_: "public-key".into(),
            }
        }
    }
    fn client_json(kind: &str, challenge: &str, origin: &str) -> Vec<u8> { format!(r#"{{"type":"{kind}","challenge":"{challenge}","origin":"{origin}","crossOrigin":false}}"#).into_bytes() }
    fn none_attestation(auth_data: &[u8]) -> Vec<u8> { [vec![0xa3, 0x63, 0x66, 0x6d, 0x74, 0x64, 0x6e, 0x6f, 0x6e, 0x65, 0x67, 0x61, 0x74, 0x74, 0x53, 0x74, 0x6d, 0x74, 0xa0, 0x68], b"authData".to_vec(), vec![0x58, u8::try_from(auth_data.len()).unwrap()], auth_data.to_vec()].concat() }
    fn webauthn() -> WebauthnCore { WebauthnCore::new_unsafe_experts_only("Vowkey", "vault.example", vec![Url::parse("https://vault.example").unwrap()], Duration::from_mins(5), None, None) }
    fn bytes(value: &Base64UrlSafeData) -> String { BASE64URL_NOPAD.encode(value.as_ref()) }
    #[test]
    fn signed_ceremony_rejects_origin_swap_replay_and_tamper() {
        let webauthn = webauthn();
        let user = Uuid::new_v4();
        let (creation, registration) = webauthn.generate_challenge_register(webauthn.new_challenge_register_builder(user.as_bytes(), "ada@example.com", "Ada").unwrap().user_verification_policy(UserVerificationPolicy::Required).require_resident_key(true)).unwrap();
        let challenge = bytes(&creation.public_key.challenge);
        let mut authenticator = SoftAuthenticator::new();
        assert!(webauthn.register_credential(&authenticator.register(&challenge, "https://evil.example", "vault.example", true), &registration, None).is_err());
        assert!(webauthn.register_credential(&authenticator.register(&challenge, "https://vault.example", "vault.example", false), &registration, None).is_err());
        let credential = webauthn.register_credential(&authenticator.register(&challenge, "https://vault.example", "vault.example", true), &registration, None).unwrap();
        let mut passkey = Passkey::from(credential.clone());
        let (request, mut state) = webauthn.generate_challenge_authenticate(webauthn.new_challenge_authenticate_builder(vec![credential], Some(UserVerificationPolicy::Required)).unwrap()).unwrap();
        state.set_allowed_credentials(Vec::new());
        let assertion_challenge = bytes(&request.public_key.challenge);
        let assertion = authenticator.assert(&assertion_challenge, "https://vault.example", "vault.example", &user);
        assert!(webauthn.authenticate_credential(&assertion, &state).is_err());
        state.set_allowed_credentials(vec![Credential::from(passkey.clone())]);
        let verified = webauthn.authenticate_credential(&assertion, &state).unwrap();
        assert_eq!(passkey.update_credential(&verified), Some(true));
        assert_eq!(assertion.get_user_unique_id(), Some(user.as_bytes().as_slice()));
        state.set_allowed_credentials(vec![Credential::from(passkey.clone())]);
        assert!(webauthn.authenticate_credential(&assertion, &state).is_err());
        let mut tampered = authenticator.assert(&assertion_challenge, "https://vault.example", "vault.example", &user);
        let mut bad = tampered.response.signature.as_ref().to_vec(); bad[0] ^= 1; tampered.response.signature = bad.into();
        state.set_allowed_credentials(vec![Credential::from(passkey.clone())]);
        assert!(webauthn.authenticate_credential(&tampered, &state).is_err());
        state.set_allowed_credentials(vec![Credential::from(passkey)]);
        assert!(webauthn.authenticate_credential(&authenticator.assert(&assertion_challenge, "https://evil.example", "vault.example", &user), &state).is_err());
    }

    #[test]
    fn prf_status_follows_the_three_wrapped_keys() {
        let mut row = WebauthnLoginCredential {
            uuid: String::from("id").into(), user_uuid: "user".into(), name: "laptop".into(), credential_id: "cred".into(),
            supports_prf: true, encrypted_user_key: None, encrypted_public_key: None, encrypted_private_key: None, passkey: "{}".into(), created_at: chrono::Utc::now().naive_utc(),
        };
        assert_eq!(row.prf_status(), 1);
        row.encrypted_user_key = Some("u".into()); row.encrypted_public_key = Some("p".into()); row.encrypted_private_key = Some("k".into());
        assert_eq!(row.prf_status(), 0);
        row.supports_prf = false; assert_eq!(row.prf_status(), 2);
    }

    #[test]
    fn creation_options_request_a_discoverable_prf_credential() {
        let options = creation_options(json!({"publicKey": {"rp": {"id": "vowkey.com"}, "extensions": {}}})).unwrap();
        assert_eq!(options["authenticatorSelection"]["residentKey"], "required");
        assert_eq!(options["extensions"]["prf"], json!({}));
    }
}
