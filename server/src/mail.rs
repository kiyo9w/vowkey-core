use std::{env::consts::EXE_SUFFIX, str::FromStr};

use chrono::NaiveDateTime;
use lettre::{
    Address, AsyncSendmailTransport, AsyncSmtpTransport, AsyncTransport, Tokio1Executor,
    message::{Attachment, Body, Mailbox, Message, MultiPart, SinglePart},
    transport::smtp::authentication::{Credentials, Mechanism as SmtpAuthMechanism},
    transport::smtp::client::{Tls, TlsParameters},
    transport::smtp::extension::ClientId,
};
use percent_encoding::{NON_ALPHANUMERIC, percent_encode};

use crate::{
    CONFIG,
    api::EmptyResult,
    auth::{
        encode_jwt, generate_delete_claims, generate_emergency_access_invite_claims, generate_invite_claims,
        generate_verify_email_claims,
    },
    db::models::{Device, DeviceType, EmergencyAccessId, MembershipId, OrganizationId, User, UserId},
    error::Error,
    util::upcase_first,
};

fn sendmail_transport() -> AsyncSendmailTransport<Tokio1Executor> {
    if let Some(command) = CONFIG.sendmail_command() {
        AsyncSendmailTransport::new_with_command(command)
    } else {
        AsyncSendmailTransport::new_with_command(format!("sendmail{EXE_SUFFIX}"))
    }
}

fn smtp_transport() -> AsyncSmtpTransport<Tokio1Executor> {
    use std::time::Duration;
    let host = CONFIG.smtp_host().unwrap();

    let smtp_client = AsyncSmtpTransport::<Tokio1Executor>::builder_dangerous(host.as_str())
        .port(CONFIG.smtp_port())
        .timeout(Some(Duration::from_secs(u64::from(CONFIG.smtp_timeout()))));

    // Determine security
    let smtp_client = if CONFIG.smtp_security() == *"off" {
        smtp_client
    } else {
        let mut tls_parameters = TlsParameters::builder(host);
        if CONFIG.smtp_accept_invalid_hostnames() {
            tls_parameters = tls_parameters.dangerous_accept_invalid_hostnames(true);
        }
        if CONFIG.smtp_accept_invalid_certs() {
            tls_parameters = tls_parameters.dangerous_accept_invalid_certs(true);
        }
        let tls_parameters = tls_parameters.build().unwrap();

        if CONFIG.smtp_security() == *"force_tls" {
            smtp_client.tls(Tls::Wrapper(tls_parameters))
        } else {
            smtp_client.tls(Tls::Required(tls_parameters))
        }
    };

    let smtp_client = match (CONFIG.smtp_username(), CONFIG.smtp_password()) {
        (Some(user), Some(pass)) => smtp_client.credentials(Credentials::new(user, pass)),
        _ => smtp_client,
    };

    let smtp_client = match CONFIG.helo_name() {
        Some(helo_name) => smtp_client.hello_name(ClientId::Domain(helo_name)),
        None => smtp_client,
    };

    let smtp_client = match CONFIG.smtp_auth_mechanism() {
        Some(mechanism) => {
            let allowed_mechanisms = [SmtpAuthMechanism::Plain, SmtpAuthMechanism::Login, SmtpAuthMechanism::Xoauth2];
            let mut selected_mechanisms = vec![];
            for wanted_mechanism in mechanism.split(',') {
                for m in &allowed_mechanisms {
                    if m.to_string().to_lowercase()
                        == wanted_mechanism.trim_matches(|c| c == '"' || c == '\'' || c == ' ').to_lowercase()
                    {
                        selected_mechanisms.push(*m);
                    }
                }
            }

            if selected_mechanisms.is_empty() {
                // Only show a warning, and return without setting an actual authentication mechanism
                warn!("No valid SMTP Auth mechanism found for '{mechanism}', using default values");
                smtp_client
            } else {
                smtp_client.authentication(selected_mechanisms)
            }
        }
        _ => smtp_client,
    };

    smtp_client.build()
}

// This will sanitize the string values by stripping all the html tags to prevent XSS and HTML Injections
fn sanitize_data(data: &mut serde_json::Value) {
    use regex::Regex;
    use std::sync::LazyLock;
    static RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"<[^>]+>").unwrap());

    match data {
        serde_json::Value::String(s) => *s = RE.replace_all(s, "").to_string(),
        serde_json::Value::Object(obj) => {
            for d in obj.values_mut() {
                sanitize_data(d);
            }
        }
        serde_json::Value::Array(arr) => {
            for d in arr.iter_mut() {
                sanitize_data(d);
            }
        }
        _ => {}
    }
}

fn get_text(template_name: &'static str, data: serde_json::Value) -> Result<(String, String, String), Error> {
    let mut data = data;
    sanitize_data(&mut data);
    let (subject_html, body_html) = get_template(&format!("{template_name}.html"), &data)?;
    let (_subject_text, body_text) = get_template(template_name, &data)?;
    Ok((subject_html, body_html, body_text))
}

fn get_template(template_name: &str, data: &serde_json::Value) -> Result<(String, String), Error> {
    let text = CONFIG.render_template(template_name, data)?;
    let mut text_split = text.split("<!---------------->");

    let subject = if let Some(s) = text_split.next() {
        s.trim().to_owned()
    } else {
        err!("Template doesn't contain subject")
    };

    let body = if let Some(s) = text_split.next() {
        s.trim().to_owned()
    } else {
        err!("Template doesn't contain body")
    };

    if text_split.next().is_some() {
        err!("Template contains more than one body");
    }

    Ok((subject, body))
}

pub async fn send_password_hint(address: &str, hint: Option<String>) -> EmptyResult {
    let template_name = if hint.is_some() {
        "email/pw_hint_some"
    } else {
        "email/pw_hint_none"
    };

    let (subject, body_html, body_text) = get_text(
        template_name,
        json!({
            "url": CONFIG.domain(),
            "img_src": CONFIG._smtp_img_src(),
            "hint": hint,
        }),
    )?;

    send_email(address, &subject, body_html, body_text).await
}

pub async fn send_delete_account(address: &str, user_id: &UserId) -> EmptyResult {
    let claims = generate_delete_claims(user_id.to_string())?;
    let delete_token = encode_jwt(&claims);

    let (subject, body_html, body_text) = get_text(
        "email/delete_account",
        json!({
            "url": CONFIG.domain(),
            "img_src": CONFIG._smtp_img_src(),
            "user_id": user_id,
            "email": percent_encode(address.as_bytes(), NON_ALPHANUMERIC).to_string(),
            "token": delete_token,
        }),
    )?;

    send_email(address, &subject, body_html, body_text).await
}

pub async fn send_verify_email(address: &str, user_id: &UserId) -> EmptyResult {
    let claims = generate_verify_email_claims(user_id)?;
    let verify_email_token = encode_jwt(&claims);

    let (subject, body_html, body_text) = get_text(
        "email/verify_email",
        json!({
            "url": CONFIG.domain(),
            "img_src": CONFIG._smtp_img_src(),
            "user_id": user_id,
            "email": percent_encode(address.as_bytes(), NON_ALPHANUMERIC).to_string(),
            "token": verify_email_token,
        }),
    )?;

    send_email(address, &subject, body_html, body_text).await
}

pub async fn send_register_verify_email(email: &str, token: &str) -> EmptyResult {
    let mut query = url::Url::parse("https://query.builder").unwrap();
    query.query_pairs_mut().append_pair("email", email).append_pair("token", token);
    let Some(query_string) = query.query() else {
        err!("Failed to build verify URL query parameters")
    };

    let (subject, body_html, body_text) = get_text(
        "email/register_verify_email",
        json!({
            // `url.Url` would place the anchor `#` after the query parameters
            "url": format!("{}/#/finish-signup/?{query_string}", CONFIG.domain()),
            "img_src": CONFIG._smtp_img_src(),
            "email": email,
        }),
    )?;

    send_email(email, &subject, body_html, body_text).await
}

pub async fn send_welcome(address: &str) -> EmptyResult {
    let (subject, body_html, body_text) = get_text(
        "email/welcome",
        json!({
            "url": CONFIG.domain(),
            "img_src": CONFIG._smtp_img_src(),
        }),
    )?;

    send_email(address, &subject, body_html, body_text).await
}

pub async fn send_welcome_must_verify(address: &str, user_id: &UserId) -> EmptyResult {
    let claims = generate_verify_email_claims(user_id)?;
    let verify_email_token = encode_jwt(&claims);

    let (subject, body_html, body_text) = get_text(
        "email/welcome_must_verify",
        json!({
            "url": CONFIG.domain(),
            "img_src": CONFIG._smtp_img_src(),
            "user_id": user_id,
            "token": verify_email_token,
        }),
    )?;

    send_email(address, &subject, body_html, body_text).await
}

pub async fn send_2fa_removed_from_org(address: &str, org_name: &str) -> EmptyResult {
    let (subject, body_html, body_text) = get_text(
        "email/send_2fa_removed_from_org",
        json!({
            "url": CONFIG.domain(),
            "img_src": CONFIG._smtp_img_src(),
            "org_name": org_name,
        }),
    )?;

    send_email(address, &subject, body_html, body_text).await
}

pub async fn send_single_org_removed_from_org(address: &str, org_name: &str) -> EmptyResult {
    let (subject, body_html, body_text) = get_text(
        "email/send_single_org_removed_from_org",
        json!({
            "url": CONFIG.domain(),
            "img_src": CONFIG._smtp_img_src(),
            "org_name": org_name,
        }),
    )?;

    send_email(address, &subject, body_html, body_text).await
}

pub async fn send_invite(
    user: &User,
    org_id: OrganizationId,
    member_id: MembershipId,
    org_name: &str,
    invited_by_email: Option<String>,
) -> EmptyResult {
    let claims = generate_invite_claims(
        user.uuid.clone(),
        user.email.clone(),
        org_id.clone(),
        member_id.clone(),
        invited_by_email,
    )?;
    let invite_token = encode_jwt(&claims);
    let mut query = url::Url::parse("https://query.builder").unwrap();
    {
        let mut query_params = query.query_pairs_mut();
        query_params
            .append_pair("email", &user.email)
            .append_pair("organizationName", org_name)
            .append_pair("organizationId", &org_id)
            .append_pair("organizationUserId", &member_id)
            .append_pair("token", &invite_token);

        if CONFIG.sso_enabled() && CONFIG.sso_only() {
            query_params.append_pair("orgSsoIdentifier", &org_id);
        }

        // The web vault requires both of these parameters to be present.
        // If either is missing it rejects the invite client-side, before any
        // request reaches the server, showing only "Unable to accept invitation".
        query_params.append_pair("initOrganization", "false");

        let org_user_has_existing_user = if user.private_key.is_some() {
            "true"
        } else {
            "false"
        };
        query_params.append_pair("orgUserHasExistingUser", org_user_has_existing_user);
    }

    let Some(query_string) = query.query() else {
        err!("Failed to build invite URL query parameters")
    };

    let (subject, body_html, body_text) = get_text(
        "email/send_org_invite",
        json!({
            // `url.Url` would place the anchor `#` after the query parameters
            "url": format!("{}/#/accept-organization/?{query_string}", CONFIG.domain()),
            "img_src": CONFIG._smtp_img_src(),
            "org_name": org_name,
        }),
    )?;

    send_email(&user.email, &subject, body_html, body_text).await
}

pub async fn send_emergency_access_invite(
    address: &str,
    user_id: UserId,
    emer_id: EmergencyAccessId,
    grantor_name: &str,
    grantor_email: &str,
) -> EmptyResult {
    let claims = generate_emergency_access_invite_claims(
        user_id,
        String::from(address),
        emer_id.clone(),
        String::from(grantor_name),
        String::from(grantor_email),
    )?;

    // Build the query here to ensure proper escaping
    let mut query = url::Url::parse("https://query.builder").unwrap();
    {
        let mut query_params = query.query_pairs_mut();
        query_params
            .append_pair("id", &emer_id.to_string())
            .append_pair("name", grantor_name)
            .append_pair("email", address)
            .append_pair("token", &encode_jwt(&claims));
    }

    let Some(query_string) = query.query() else {
        err!("Failed to build emergency invite URL query parameters")
    };

    let (subject, body_html, body_text) = get_text(
        "email/send_emergency_access_invite",
        json!({
            // `url.Url` would place the anchor `#` after the query parameters
            "url": format!("{}/#/accept-emergency/?{query_string}", CONFIG.domain()),
            "img_src": CONFIG._smtp_img_src(),
            "grantor_name": grantor_name,
        }),
    )?;

    send_email(address, &subject, body_html, body_text).await
}

pub async fn send_emergency_access_invite_accepted(address: &str, grantee_email: &str) -> EmptyResult {
    let (subject, body_html, body_text) = get_text(
        "email/emergency_access_invite_accepted",
        json!({
            "url": CONFIG.domain(),
            "img_src": CONFIG._smtp_img_src(),
            "grantee_email": grantee_email,
        }),
    )?;

    send_email(address, &subject, body_html, body_text).await
}

pub async fn send_emergency_access_invite_confirmed(address: &str, grantor_name: &str) -> EmptyResult {
    let (subject, body_html, body_text) = get_text(
        "email/emergency_access_invite_confirmed",
        json!({
            "url": CONFIG.domain(),
            "img_src": CONFIG._smtp_img_src(),
            "grantor_name": grantor_name,
        }),
    )?;

    send_email(address, &subject, body_html, body_text).await
}

pub async fn send_emergency_access_recovery_approved(address: &str, grantor_name: &str) -> EmptyResult {
    let (subject, body_html, body_text) = get_text(
        "email/emergency_access_recovery_approved",
        json!({
            "url": CONFIG.domain(),
            "img_src": CONFIG._smtp_img_src(),
            "grantor_name": grantor_name,
        }),
    )?;

    send_email(address, &subject, body_html, body_text).await
}

pub async fn send_emergency_access_recovery_initiated(
    address: &str,
    grantee_name: &str,
    atype: &str,
    wait_time_days: &i32,
) -> EmptyResult {
    let (subject, body_html, body_text) = get_text(
        "email/emergency_access_recovery_initiated",
        json!({
            "url": CONFIG.domain(),
            "img_src": CONFIG._smtp_img_src(),
            "grantee_name": grantee_name,
            "atype": atype,
            "wait_time_days": wait_time_days,
        }),
    )?;

    send_email(address, &subject, body_html, body_text).await
}

pub async fn send_emergency_access_recovery_reminder(
    address: &str,
    grantee_name: &str,
    atype: &str,
    days_left: &str,
) -> EmptyResult {
    let (subject, body_html, body_text) = get_text(
        "email/emergency_access_recovery_reminder",
        json!({
            "url": CONFIG.domain(),
            "img_src": CONFIG._smtp_img_src(),
            "grantee_name": grantee_name,
            "atype": atype,
            "days_left": days_left,
        }),
    )?;

    send_email(address, &subject, body_html, body_text).await
}

pub async fn send_emergency_access_recovery_rejected(address: &str, grantor_name: &str) -> EmptyResult {
    let (subject, body_html, body_text) = get_text(
        "email/emergency_access_recovery_rejected",
        json!({
            "url": CONFIG.domain(),
            "img_src": CONFIG._smtp_img_src(),
            "grantor_name": grantor_name,
        }),
    )?;

    send_email(address, &subject, body_html, body_text).await
}

pub async fn send_emergency_access_recovery_timed_out(address: &str, grantee_name: &str, atype: &str) -> EmptyResult {
    let (subject, body_html, body_text) = get_text(
        "email/emergency_access_recovery_timed_out",
        json!({
            "url": CONFIG.domain(),
            "img_src": CONFIG._smtp_img_src(),
            "grantee_name": grantee_name,
            "atype": atype,
        }),
    )?;

    send_email(address, &subject, body_html, body_text).await
}

pub async fn send_invite_accepted(new_user_email: &str, address: &str, org_name: &str) -> EmptyResult {
    let (subject, body_html, body_text) = get_text(
        "email/invite_accepted",
        json!({
            "url": CONFIG.domain(),
            "img_src": CONFIG._smtp_img_src(),
            "email": new_user_email,
            "org_name": org_name,
        }),
    )?;

    send_email(address, &subject, body_html, body_text).await
}

pub async fn send_invite_confirmed(address: &str, org_name: &str) -> EmptyResult {
    let (subject, body_html, body_text) = get_text(
        "email/invite_confirmed",
        json!({
            "url": CONFIG.domain(),
            "img_src": CONFIG._smtp_img_src(),
            "org_name": org_name,
        }),
    )?;

    send_email(address, &subject, body_html, body_text).await
}

pub async fn send_new_device_logged_in(address: &str, ip: &str, dt: &NaiveDateTime, device: &Device) -> EmptyResult {
    let fmt = "%A, %B %_d, %Y at %r %Z";
    let (subject, body_html, body_text) = get_text(
        "email/new_device_logged_in",
        json!({
            "url": CONFIG.domain(),
            "img_src": CONFIG._smtp_img_src(),
            "ip": ip,
            "device_name": upcase_first(&device.name),
            "device_type": DeviceType::from_i32(device.atype).to_string(),
            "datetime": crate::util::format_naive_datetime_local(dt, fmt),
        }),
    )?;

    send_email(address, &subject, body_html, body_text).await
}

pub async fn send_recover_twofactor(address: &str, ip: &str, dt: &NaiveDateTime) -> EmptyResult {
    let fmt = "%A, %B %_d, %Y at %r %Z";
    let (subject, body_html, body_text) = get_text(
        "email/recover_twofactor",
        json!({
            "url": CONFIG.domain(),
            "img_src": CONFIG._smtp_img_src(),
            "ip": ip,
            "datetime": crate::util::format_naive_datetime_local(dt, fmt),
        }),
    )?;

    send_email(address, &subject, body_html, body_text).await
}

pub async fn send_incomplete_2fa_login(
    address: &str,
    ip: &str,
    dt: &NaiveDateTime,
    device_name: &str,
    device_type: &str,
) -> EmptyResult {
    let fmt = "%A, %B %_d, %Y at %r %Z";
    let (subject, body_html, body_text) = get_text(
        "email/incomplete_2fa_login",
        json!({
            "url": CONFIG.domain(),
            "img_src": CONFIG._smtp_img_src(),
            "ip": ip,
            "device_name": upcase_first(device_name),
            "device_type": device_type,
            "datetime": crate::util::format_naive_datetime_local(dt, fmt),
            "time_limit": CONFIG.incomplete_2fa_time_limit(),
        }),
    )?;

    send_email(address, &subject, body_html, body_text).await
}

pub async fn send_token(address: &str, token: &str) -> EmptyResult {
    let (subject, body_html, body_text) = get_text(
        "email/twofactor_email",
        json!({
            "url": CONFIG.domain(),
            "img_src": CONFIG._smtp_img_src(),
            "token": token,
        }),
    )?;

    send_email(address, &subject, body_html, body_text).await
}

pub async fn send_change_email(address: &str, token: &str) -> EmptyResult {
    let (subject, body_html, body_text) = get_text(
        "email/change_email",
        json!({
            "url": CONFIG.domain(),
            "img_src": CONFIG._smtp_img_src(),
            "token": token,
        }),
    )?;

    send_email(address, &subject, body_html, body_text).await
}

pub async fn send_change_email_existing(address: &str, acting_address: &str) -> EmptyResult {
    let (subject, body_html, body_text) = get_text(
        "email/change_email_existing",
        json!({
            "url": CONFIG.domain(),
            "img_src": CONFIG._smtp_img_src(),
            "existing_address": address,
            "acting_address": acting_address,
        }),
    )?;

    send_email(address, &subject, body_html, body_text).await
}

pub async fn send_change_email_invited(address: &str, acting_address: &str) -> EmptyResult {
    let (subject, body_html, body_text) = get_text(
        "email/change_email_invited",
        json!({
            "url": CONFIG.domain(),
            "img_src": CONFIG._smtp_img_src(),
            "existing_address": address,
            "acting_address": acting_address,
        }),
    )?;

    send_email(address, &subject, body_html, body_text).await
}

pub async fn send_sso_change_email(address: &str) -> EmptyResult {
    let (subject, body_html, body_text) = get_text(
        "email/sso_change_email",
        json!({
            "url": format!("{}/#/settings/account", CONFIG.domain()),
            "img_src": CONFIG._smtp_img_src(),
        }),
    )?;

    send_email(address, &subject, body_html, body_text).await
}

pub async fn send_test(address: &str) -> EmptyResult {
    let (subject, body_html, body_text) = get_text(
        "email/smtp_test",
        json!({
            "url": CONFIG.domain(),
            "img_src": CONFIG._smtp_img_src(),
        }),
    )?;

    send_email(address, &subject, body_html, body_text).await
}

pub async fn send_admin_account_recovery(
    address: &str,
    user_name: &str,
    org_name: &str,
    reset_password: bool,
    reset_2fa: bool,
    fallback_2fa_email: bool,
) -> EmptyResult {
    let (subject, body_html, body_text) = get_text(
        "email/admin_account_recovery",
        json!({
            "url": CONFIG.domain(),
            "img_src": CONFIG._smtp_img_src(),
            "user_name": user_name,
            "org_name": org_name,
            "reset_password": reset_password,
            "reset_2fa": reset_2fa,
            "fallback_2fa_email": fallback_2fa_email,
        }),
    )?;
    send_email(address, &subject, body_html, body_text).await
}

pub async fn send_protected_action_token(address: &str, token: &str) -> EmptyResult {
    let (subject, body_html, body_text) = get_text(
        "email/protected_action",
        json!({
            "url": CONFIG.domain(),
            "img_src": CONFIG._smtp_img_src(),
            "token": token,
        }),
    )?;

    send_email(address, &subject, body_html, body_text).await
}

#[derive(Clone, Debug)]
pub struct MailAttachment {
    pub filename: String,
    pub content_type: String,
    pub content: Vec<u8>,
    /// Set for images referenced as `cid:` in the HTML body.
    pub content_id: Option<String>,
}

/// Fields both HTTP providers accept. SMTP and sendmail keep a `lettre` message.
#[derive(Clone, Debug)]
pub struct OutboundMail {
    pub from_name: String,
    pub from: String,
    pub reply_to: Option<String>,
    pub to: Vec<String>,
    pub subject: String,
    pub html: String,
    pub text: String,
    pub headers: Vec<(String, String)>,
    pub attachments: Vec<MailAttachment>,
}

fn is_http_provider(provider: &str) -> bool {
    matches!(provider, "resend" | "postmark")
}

fn email_provider() -> String {
    CONFIG.email_provider().trim().to_ascii_lowercase()
}

fn provider_endpoint(provider: &str) -> Result<String, Error> {
    if let Some(url) = CONFIG.email_api_url() {
        let url = url.trim().trim_end_matches('/').to_owned();
        if url.is_empty() {
            err!("Email provider URL is empty");
        }
        return Ok(url);
    }
    Ok(match provider {
        "resend" => "https://api.resend.com/emails".to_owned(),
        "postmark" => "https://api.postmarkapp.com/email".to_owned(),
        _ => err!("Email provider is not an HTTP provider"),
    })
}

fn named_address(name: &str, address: &str) -> String {
    let name = name.trim();
    if name.is_empty() {
        address.to_owned()
    } else {
        format!("{name} <{address}>")
    }
}

fn header_allowed(name: &str) -> bool {
    !matches!(
        name.to_ascii_lowercase().as_str(),
        "from"
            | "to"
            | "cc"
            | "bcc"
            | "subject"
            | "reply-to"
            | "mime-version"
            | "content-type"
            | "content-transfer-encoding"
            | "content-disposition"
            | "content-id"
            | "date"
            | "message-id"
    )
}

fn provider_payload(provider: &str, mail: &OutboundMail) -> serde_json::Value {
    let from = named_address(&mail.from_name, &mail.from);
    let headers: Vec<(&str, &str)> = mail
        .headers
        .iter()
        .filter(|(name, _)| header_allowed(name))
        .map(|(name, value)| (name.as_str(), value.as_str()))
        .collect();
    let attachments: Vec<serde_json::Value> = mail
        .attachments
        .iter()
        .map(|attachment| {
            let content = data_encoding::BASE64.encode(&attachment.content);
            match provider {
                "resend" => {
                    let mut value = json!({
                        "filename": attachment.filename,
                        "content": content,
                        "content_type": attachment.content_type,
                    });
                    if let Some(id) = &attachment.content_id {
                        value["content_id"] = json!(id.trim_matches(['<', '>']));
                    }
                    value
                }
                _ => {
                    let mut value = json!({
                        "Name": attachment.filename,
                        "Content": content,
                        "ContentType": attachment.content_type,
                    });
                    if let Some(id) = &attachment.content_id {
                        value["ContentID"] = json!(format!("cid:{}", id.trim_matches(['<', '>'])));
                    }
                    value
                }
            }
        })
        .collect();

    match provider {
        "resend" => {
            let mut body = json!({
                "from": from,
                "to": mail.to,
                "subject": mail.subject,
                "html": mail.html,
                "text": mail.text,
            });
            if let Some(reply_to) = &mail.reply_to {
                body["reply_to"] = json!(reply_to);
            }
            if !headers.is_empty() {
                body["headers"] = headers.into_iter().collect();
            }
            if !attachments.is_empty() {
                body["attachments"] = json!(attachments);
            }
            body
        }
        _ => {
            let mut body = json!({
                "From": from,
                "To": mail.to.join(","),
                "Subject": mail.subject,
                "HtmlBody": mail.html,
                "TextBody": mail.text,
                "MessageStream": "outbound",
            });
            if let Some(reply_to) = &mail.reply_to {
                body["ReplyTo"] = json!(reply_to);
            }
            if !headers.is_empty() {
                body["Headers"] = json!(
                    headers
                        .into_iter()
                        .map(|(name, value)| json!({ "Name": name, "Value": value }))
                        .collect::<Vec<_>>()
                );
            }
            if !attachments.is_empty() {
                body["Attachments"] = json!(attachments);
            }
            body
        }
    }
}

fn provider_failure(provider: &str, status: Option<u16>, timed_out: bool) -> Error {
    let message = if timed_out {
        format!("{provider} timeout")
    } else if let Some(status) = status {
        format!("{provider} HTTP {status}")
    } else {
        format!("{provider} request failed")
    };
    // The provider body and the recipient stay in the transport, not in this error.
    debug!("{message}");
    Error::new_msg(message)
}

fn authorized(provider: &str, request: reqwest::RequestBuilder, key: &str) -> Result<reqwest::RequestBuilder, Error> {
    Ok(match provider {
        "resend" => request.bearer_auth(key),
        "postmark" => request.header("X-Postmark-Server-Token", key),
        _ => err!("Email provider is not an HTTP provider"),
    })
}

async fn read_provider(provider: &str, response: Result<reqwest::Response, reqwest::Error>) -> EmptyResult {
    let response = match response {
        Ok(response) => response,
        Err(error) => return Err(provider_failure(provider, None, error.is_timeout())),
    };
    let status = response.status();
    if status.is_success() {
        return Ok(());
    }
    // Drop the body before building the error so a 4xx explanation cannot leak an address.
    drop(response);
    Err(provider_failure(provider, Some(status.as_u16()), false))
}

async fn post_provider(
    provider: &str,
    request: reqwest::RequestBuilder,
    key: &str,
    mail: &OutboundMail,
) -> EmptyResult {
    let request = request.header(reqwest::header::ACCEPT, "application/json")
        .json(&provider_payload(provider, mail));
    let request = authorized(provider, request, key)?;
    read_provider(provider, request.send().await).await
}

async fn send_http(provider: &str, mail: &OutboundMail) -> EmptyResult {
    if mail.to.is_empty() {
        err!("Email has no recipient");
    }
    let url = provider_endpoint(provider)?;
    let key = CONFIG.email_api_key();
    if key.is_empty() {
        err!("Email provider API key is not set");
    }
    static CLIENT: std::sync::LazyLock<reqwest::Client> = std::sync::LazyLock::new(|| {
        crate::http_client::get_reqwest_client_builder(true)
            .redirect(reqwest::redirect::Policy::none())
            .build().expect("Failed to build mail HTTP client")
    });
    let request = CLIENT.post(url)
        .timeout(std::time::Duration::from_secs(u64::from(CONFIG.smtp_timeout())));
    post_provider(provider, request, &key, mail).await
}

pub async fn send_welcome_from_guest(address: &str) -> EmptyResult {
    let (subject, body_html, body_text) = get_text(
        "email/welcome_from_guest",
        json!({
            "url": CONFIG.domain(),
            "img_src": CONFIG._smtp_img_src(),
        }),
    )?;
    send_email(address, &subject, body_html, body_text).await
}

pub async fn send_office_seats_changed(address: &str, org_name: &str, seats: i32) -> EmptyResult {
    let (subject, body_html, body_text) = get_text(
        "email/office_seats_changed",
        json!({
            "url": CONFIG.domain(),
            "img_src": CONFIG._smtp_img_src(),
            "org_name": org_name,
            "seats": seats,
        }),
    )?;
    send_email(address, &subject, body_html, body_text).await
}

pub async fn send_decision_allowance_low(address: &str, credit_units: i64, allowance_month: i32) -> EmptyResult {
    let (subject, body_html, body_text) = get_text(
        "email/decision_allowance_low",
        json!({
            "url": CONFIG.domain(),
            "img_src": CONFIG._smtp_img_src(),
            "credit_units": credit_units,
            "allowance_month": allowance_month,
        }),
    )?;
    send_email(address, &subject, body_html, body_text).await
}

pub async fn send_payment_failed(address: &str, portal_url: &str) -> EmptyResult {
    let (subject, body_html, body_text) = get_text(
        "email/payment_failed",
        json!({
            "url": CONFIG.domain(),
            "img_src": CONFIG._smtp_img_src(),
            "portal_url": portal_url,
        }),
    )?;
    send_email(address, &subject, body_html, body_text).await
}

async fn send_with_selected_transport(email: Message, http_mail: Option<OutboundMail>) -> EmptyResult {
    let provider = email_provider();
    if is_http_provider(&provider) {
        let Some(mail) = http_mail else {
            err!("HTTP email is missing its message");
        };
        return send_http(&provider, &mail).await;
    }
    if CONFIG.use_sendmail() {
        match sendmail_transport().send(email).await {
            Ok(()) => Ok(()),
            // Match some common errors and make them more user friendly
            Err(e) => {
                if e.is_client() {
                    debug!("Sendmail client error: {e:?}");
                    err!(format!("Sendmail client error: {e}"));
                } else if e.is_response() {
                    debug!("Sendmail response error: {e:?}");
                    err!(format!("Sendmail response error: {e}"));
                }
                debug!("Sendmail error: {e:?}");
                err!(format!("Sendmail error: {e}"));
            }
        }
    } else {
        match smtp_transport().send(email).await {
            Ok(_) => Ok(()),
            // Match some common errors and make them more user friendly
            Err(e) => {
                if e.is_client() {
                    debug!("SMTP client error: {e:#?}");
                    err!(format!("SMTP client error: {e}"));
                } else if e.is_transient() {
                    debug!("SMTP 4xx error: {e:#?}");
                    err!(format!("SMTP 4xx error: {e}"));
                } else if e.is_permanent() {
                    debug!("SMTP 5xx error: {e:#?}");
                    let mut msg = e.to_string();
                    // Add a special check for 535 to add a more descriptive message
                    if msg.contains("(535)") {
                        msg = format!("{msg} - Authentication credentials invalid");
                    }
                    err!(format!("SMTP 5xx error: {msg}"));
                } else if e.is_timeout() {
                    debug!("SMTP timeout error: {e:#?}");
                    err!(format!("SMTP timeout error: {e}"));
                } else if e.is_tls() {
                    debug!("SMTP encryption error: {e:#?}");
                    err!(format!("SMTP encryption error: {e}"));
                }
                debug!("SMTP error: {e:#?}");
                err!(format!("SMTP error: {e}"));
            }
        }
    }
}

async fn send_email(address: &str, subject: &str, body_html: String, body_text: String) -> EmptyResult {
    let smtp_from = CONFIG.smtp_from();
    let from_address = Address::from_str(&smtp_from)?;
    let message_id = format!("<{}@{}>", crate::util::get_uuid(), from_address.domain());

    let mut attachments = Vec::new();
    let body = if CONFIG.smtp_embed_images() {
        let logo = crate::api::STATIC_FILES["logo-gray.png"].bytes.to_vec();
        let github = crate::api::STATIC_FILES["mail-github.png"].bytes.to_vec();
        attachments.push(MailAttachment {
            filename: "logo-gray.png".to_owned(),
            content_type: "image/png".to_owned(),
            content: logo.clone(),
            content_id: Some("logo-gray.png".to_owned()),
        });
        attachments.push(MailAttachment {
            filename: "mail-github.png".to_owned(),
            content_type: "image/png".to_owned(),
            content: github.clone(),
            content_id: Some("mail-github.png".to_owned()),
        });
        MultiPart::alternative().singlepart(SinglePart::plain(body_text.clone())).multipart(
            MultiPart::related()
                .singlepart(SinglePart::html(body_html.clone()))
                .singlepart(
                    Attachment::new_inline(String::from("logo-gray.png"))
                        .body(Body::new(logo), "image/png".parse().unwrap()),
                )
                .singlepart(
                    Attachment::new_inline(String::from("mail-github.png"))
                        .body(Body::new(github), "image/png".parse().unwrap()),
                ),
        )
    } else {
        MultiPart::alternative_plain_html(body_text.clone(), body_html.clone())
    };

    let email = Message::builder()
        .message_id(Some(message_id.clone()))
        .to(Mailbox::new(None, Address::from_str(address)?))
        .from(Mailbox::new(Some(CONFIG.smtp_from_name()), from_address))
        .subject(subject)
        .multipart(body)?;

    let http_mail = is_http_provider(&email_provider()).then(|| OutboundMail {
        from_name: CONFIG.smtp_from_name(),
        from: smtp_from,
        reply_to: None,
        to: vec![address.to_owned()],
        subject: subject.to_owned(),
        html: body_html,
        text: body_text,
        headers: vec![("Message-ID".to_owned(), message_id)],
        attachments,
    });

    send_with_selected_transport(email, http_mail).await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_mail() -> OutboundMail {
        OutboundMail {
            from_name: "Vowkey".to_owned(),
            from: "accounts@mail.example.com".to_owned(),
            reply_to: Some("support@mail.example.com".to_owned()),
            to: vec!["person@example.net".to_owned()],
            subject: "Your vault is ready".to_owned(),
            html: "<p>Ready</p>".to_owned(),
            text: "Ready".to_owned(),
            headers: vec![
                ("Message-ID".to_owned(), "<abc@mail.example.com>".to_owned()),
                ("X-Vowkey-Kind".to_owned(), "welcome_from_guest".to_owned()),
            ],
            attachments: vec![MailAttachment {
                filename: "logo-gray.png".to_owned(),
                content_type: "image/png".to_owned(),
                content: b"png".to_vec(),
                content_id: Some("<logo-gray.png>".to_owned()),
            }],
        }
    }

    #[test]
    fn resend_maps_message_fields_and_drops_mime_headers() {
        let body = provider_payload("resend", &sample_mail());
        assert_eq!(body["from"], "Vowkey <accounts@mail.example.com>");
        assert_eq!(body["to"][0], "person@example.net");
        assert_eq!(body["reply_to"], "support@mail.example.com");
        assert_eq!(body["html"], "<p>Ready</p>");
        assert_eq!(body["text"], "Ready");
        assert_eq!(body["headers"]["X-Vowkey-Kind"], "welcome_from_guest");
        assert!(body["headers"].get("Message-ID").is_none());
        assert_eq!(body["attachments"][0]["filename"], "logo-gray.png");
        assert_eq!(body["attachments"][0]["content"], data_encoding::BASE64.encode(b"png"));
        assert_eq!(body["attachments"][0]["content_id"], "logo-gray.png");
    }

    #[test]
    fn postmark_maps_message_fields() {
        let body = provider_payload("postmark", &sample_mail());
        assert_eq!(body["From"], "Vowkey <accounts@mail.example.com>");
        assert_eq!(body["To"], "person@example.net");
        assert_eq!(body["ReplyTo"], "support@mail.example.com");
        assert_eq!(body["HtmlBody"], "<p>Ready</p>");
        assert_eq!(body["TextBody"], "Ready");
        assert_eq!(body["MessageStream"], "outbound");
        assert_eq!(body["Headers"][0]["Name"], "X-Vowkey-Kind");
        assert_eq!(body["Attachments"][0]["ContentID"], "cid:logo-gray.png");
    }

    #[test]
    fn provider_errors_name_status_without_body_or_recipient() {
        let cases = [
            (Some(422), false, "resend HTTP 422"),
            (Some(500), false, "postmark HTTP 500"),
            (None, true, "resend timeout"),
            (None, false, "postmark request failed"),
        ];
        for (status, timed_out, expected) in cases {
            let error = provider_failure(expected.split_once(' ').unwrap().0, status, timed_out);
            let rendered = error.to_string();
            assert!(rendered.contains(expected), "{rendered}");
            assert!(!rendered.contains("person@"));
            assert!(!rendered.contains("invalid recipient"));
        }
    }

    fn serve(status: u16, hold: std::time::Duration) -> (String, std::thread::JoinHandle<()>) {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let handle = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            stream.set_read_timeout(Some(std::time::Duration::from_secs(2))).unwrap();
            let mut buf = [0; 4096];
            drop(std::io::Read::read(&mut stream, &mut buf));
            std::thread::sleep(hold);
            let body = b"{\"message\":\"invalid recipient person@example.net\"}";
            let response = format!(
                "HTTP/1.1 {status} {}\r\ncontent-length: {}\r\nconnection: close\r\n\r\n",
                if status == 200 { "OK" } else { "ERR" },
                body.len()
            );
            drop(std::io::Write::write_all(&mut stream, response.as_bytes()));
            drop(std::io::Write::write_all(&mut stream, body));
        });
        (format!("http://127.0.0.1:{port}/emails"), handle)
    }

    #[tokio::test]
    async fn http_provider_accepts_success_and_hides_failures() {
        crate::install_rustls_crypto_provider();
        for (provider, status) in [("resend", 200u16), ("postmark", 422), ("resend", 500)] {
            let (url, handle) = serve(status, std::time::Duration::ZERO);
            let result =
                post_provider(provider, reqwest::Client::new().post(&url).timeout(std::time::Duration::from_secs(2)), "test-key", &sample_mail()).await;
            handle.join().unwrap();
            match status {
                200 => assert!(result.is_ok()),
                _ => {
                    let rendered = result.unwrap_err().to_string();
                    assert!(rendered.contains(&format!("{provider} HTTP {status}")));
                    assert!(!rendered.contains("person@"));
                    assert!(!rendered.contains("invalid recipient"));
                }
            }
        }

        let (url, handle) = serve(200, std::time::Duration::from_secs(3));
        let result =
            post_provider("resend", reqwest::Client::new().post(&url).timeout(std::time::Duration::from_secs(1)), "test-key", &sample_mail()).await;
        let rendered = result.unwrap_err().to_string();
        assert!(rendered.contains("resend timeout"), "{rendered}");
        assert!(!rendered.contains("person@"));
        handle.join().unwrap();
    }
}
