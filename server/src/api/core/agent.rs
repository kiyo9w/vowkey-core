use chrono::{NaiveDateTime, Utc};
use diesel::prelude::*;
use rocket::{Route, http::Status, response::status::Custom, serde::json::Json};
use serde_json::Value;

use crate::{
    api::{EmptyResult, JsonResult},
    auth::{Headers, OwnerHeaders},
    db::{
        DbConn, DbPool,
        models::*,
        schema::{agent_grants, agent_pairings, agent_requests, form_bindings},
    },
    error::Error,
};

type Reply = Result<Custom<Json<Value>>, Error>;
fn reply(status: Status, value: Value) -> Reply {
    Ok(Custom(status, Json(value)))
}
fn conflict(code: &str, revision: i32, answer: Option<&str>) -> Reply {
    reply(Status::Conflict, json!({"message":code,"code":code,"revision":revision,"answer":answer}))
}
fn invalid() -> Error {
    Error::new_msg("invalid_payload").with_code(422)
}
pub(super) fn ciphertext(value: &str) -> EmptyResult {
    if value.is_empty() || value.len() > 262_144 {
        return Err(invalid());
    }
    let (kind, encoded) = value.split_once('.').ok_or_else(invalid)?;
    let parts = encoded
        .split('|')
        .map(|s| data_encoding::BASE64.decode(s.as_bytes()))
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| invalid())?;
    if kind == "7" {
        return if parts.len() == 1 && !parts[0].is_empty() {
            Ok(())
        } else {
            Err(invalid())
        };
    }
    if !matches!((kind, parts.len()), ("0", 2) | ("2", 3))
        || parts[0].len() != 16
        || parts[1].is_empty()
        || parts[1].len() % 16 != 0
        || (kind == "2" && parts[2].len() != 32)
    {
        return Err(invalid());
    }
    Ok(())
}
fn id(value: &str) -> EmptyResult {
    if uuid::Uuid::parse_str(value).is_err() {
        return Err(invalid());
    }
    Ok(())
}
async fn source(source: &CipherId, headers: &Headers, conn: &DbConn) -> Result<Cipher, Error> {
    match Cipher::find_by_uuid(source, conn).await {
        Some(c)
            if c.deleted_at.is_none()
                && !c.migration_pending
                && c.is_accessible_to_user(&headers.user.uuid, conn).await =>
        {
            Ok(c)
        }
        _ => Err(Error::new_msg("no_access").with_code(404)),
    }
}
async fn request_sources(row: &AgentRequest, headers: &Headers, conn: &DbConn) -> EmptyResult {
    for cipher in serde_json::from_str::<Vec<CipherId>>(&row.cipher_ids)? {
        source(&cipher, headers, conn).await?;
    }
    Ok(())
}
fn parse_date(value: Option<&str>) -> Result<Option<NaiveDateTime>, Error> {
    value.map(|v| chrono::DateTime::parse_from_rfc3339(v).map(|d| d.naive_utc()).map_err(|_| invalid())).transpose()
}

async fn account_transaction<T, F>(headers: &Headers, conn: &DbConn, operation: F) -> Result<T, Error>
where
    F: Future<Output = Result<T, Error>>,
{
    conn.transaction(async {
        conn.run(|c| {
            diesel::update(crate::db::schema::agent_revision::table)
                .set(crate::db::schema::agent_revision::revision.eq(crate::db::schema::agent_revision::revision))
                .execute(c)
        })
        .await?;
        let current = User::find_by_uuid(&headers.user.uuid, conn)
            .await
            .ok_or_else(|| Error::new_msg("account_changed").with_code(401))?;
        if current.security_stamp != headers.user.security_stamp {
            return Err(Error::new_msg("account_changed").with_code(401));
        }
        operation.await
    })
    .await
}

pub fn routes() -> Vec<Route> {
    routes![
        post_pairing,
        put_pairing,
        post_request,
        put_answer,
        put_result,
        post_grant,
        put_grant,
        post_activity,
        sync,
        get_bindings,
        put_binding,
        put_binding_id,
        delete_binding,
        export,
        rotation_records,
        rotate_org_activity
    ]
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PairingData {
    pairing_id: AgentPairingId,
    encrypted_metadata: String,
    local_executor_id: String,
    executor_device_id: Option<DeviceId>,
}
#[post("/agent/pairings", data = "<data>")]
async fn post_pairing(data: Json<PairingData>, headers: Headers, conn: DbConn) -> Reply {
    account_transaction(&headers, &conn, post_pairing_inner(data, &headers, &conn)).await
}
async fn post_pairing_inner(data: Json<PairingData>, headers: &Headers, conn: &DbConn) -> Reply {
    let d = data.into_inner();
    id(d.pairing_id.as_ref())?;
    ciphertext(&d.encrypted_metadata)?;
    id(&d.local_executor_id)?;
    if d.executor_device_id.as_ref().is_some_and(|v| v != &headers.device.uuid) {
        return Err(invalid());
    }
    let row = AgentPairing::new(
        d.pairing_id.clone(),
        headers.user.uuid.clone(),
        d.local_executor_id,
        Some(headers.device.uuid.clone()),
        d.encrypted_metadata,
    );
    let saved = row.clone();
    let result = commit_agent_change(&conn, move |c, revision| {
        let mut row = saved;
        row.revision = revision;
        diesel::insert_into(agent_pairings::table).values(&row).execute(c)?;
        Ok(row)
    })
    .await;
    match result {
        Ok(saved) => reply(Status::Ok, saved.to_json()),
        Err(error) => match AgentPairing::find(&d.pairing_id, &headers.user.uuid, &conn).await {
            Some(saved)
                if saved.encrypted_metadata == row.encrypted_metadata
                    && saved.local_executor_id == row.local_executor_id
                    && saved.executor_device_id == row.executor_device_id =>
            {
                reply(Status::Ok, saved.to_json())
            }
            Some(saved) => conflict("revision_mismatch", saved.revision, None),
            None => Err(error),
        },
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RevokeData {
    revision: i32,
    revoked_at: Option<String>,
}
#[put("/agent/pairings/<pairing_id>", data = "<data>")]
async fn put_pairing(pairing_id: AgentPairingId, data: Json<RevokeData>, headers: Headers, conn: DbConn) -> Reply {
    account_transaction(&headers, &conn, put_pairing_inner(pairing_id, data, &headers, &conn)).await
}
async fn put_pairing_inner(
    pairing_id: AgentPairingId,
    data: Json<RevokeData>,
    headers: &Headers,
    conn: &DbConn,
) -> Reply {
    let Some(mut row) = AgentPairing::find(&pairing_id, &headers.user.uuid, &conn).await else {
        return Err(Error::new_msg("not_found").with_code(404));
    };
    let d = data.into_inner();
    if d.revision < 1 || d.revoked_at.is_none() {
        return Err(invalid());
    }
    row.revoked_at = Some(Utc::now().naive_utc());
    parse_date(d.revoked_at.as_deref())?;
    row.updated_at = Utc::now().naive_utc();
    let saved = commit_agent_change(&conn, move |c, revision| {
        row.revision = revision;
        let changed = diesel::update(
            agent_pairings::table
                .filter(agent_pairings::uuid.eq(&row.uuid))
                .filter(agent_pairings::user_uuid.eq(&row.user_uuid))
                .filter(agent_pairings::revision.eq(d.revision)),
        )
        .set(&row)
        .execute(c)?;
        Ok((changed, row))
    })
    .await?;
    if saved.0 != 1 {
        let current = AgentPairing::find(&pairing_id, &headers.user.uuid, &conn).await.ok_or_else(invalid)?;
        return conflict("revision_mismatch", current.revision, None);
    }
    reply(Status::Ok, saved.1.to_json())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RequestData {
    request_id: AgentRequestId,
    pairing_id: AgentPairingId,
    cipher_ids: Vec<CipherId>,
    routing: String,
    note: Option<String>,
    executor_device_id: Option<DeviceId>,
}
#[post("/agent/requests", data = "<data>")]
async fn post_request(data: Json<RequestData>, headers: Headers, conn: DbConn) -> Reply {
    account_transaction(&headers, &conn, post_request_inner(data, &headers, &conn)).await
}
async fn post_request_inner(data: Json<RequestData>, headers: &Headers, conn: &DbConn) -> Reply {
    let d = data.into_inner();
    ciphertext(&d.routing)?;
    id(d.request_id.as_ref())?;
    id(d.pairing_id.as_ref())?;
    if let Some(note) = &d.note {
        ciphertext(note)?;
    }
    if d.cipher_ids.is_empty()
        || d.cipher_ids.len() > 100
        || d.executor_device_id.as_ref().is_some_and(|v| v != &headers.device.uuid)
    {
        return Err(invalid());
    }
    let pairing = AgentPairing::find(&d.pairing_id, &headers.user.uuid, &conn)
        .await
        .ok_or_else(|| Error::new_msg("unpaired").with_code(404))?;
    if pairing.revoked_at.is_some() {
        return Err(Error::new_msg("pairing_revoked").with_code(409));
    }
    if pairing.executor_device_id.as_ref() != Some(&headers.device.uuid) {
        return Err(Error::new_msg("not_executor").with_code(403));
    }
    for cipher in &d.cipher_ids {
        id(cipher.as_ref())?;
        source(cipher, &headers, &conn).await?;
    }
    let ids = serde_json::to_string(&d.cipher_ids)?;
    let request_hash = crate::crypto::sha256_hex(&serde_json_canonicalizer::to_vec(
        &json!({"pairingId":d.pairing_id,"cipherIds":d.cipher_ids,"routing":d.routing,"note":d.note,"executorDeviceId":headers.device.uuid}),
    )?);
    let mut row = AgentRequest::new(
        d.request_id.clone(),
        headers.user.uuid.clone(),
        d.pairing_id.to_string(),
        headers.device.uuid.clone(),
        ids,
        d.routing,
        d.note,
    );
    row.request_hash = request_hash.clone();
    let result = commit_agent_change(&conn, move |c, revision| {
        row.revision = revision;
        let pairing = agent_pairings::table
            .filter(agent_pairings::uuid.eq(&row.pairing_uuid))
            .filter(agent_pairings::user_uuid.eq(&row.user_uuid))
            .filter(agent_pairings::revoked_at.is_null())
            .count()
            .get_result::<i64>(c)?;
        if pairing != 1 {
            return Err(Error::new_msg("pairing_revoked").with_code(409));
        }
        diesel::insert_into(agent_requests::table).values(&row).execute(c)?;
        Ok(row)
    })
    .await;
    match result {
        Ok(row) => reply(Status::Ok, row.to_json()),
        Err(error) => match AgentRequest::find(&d.request_id, &headers.user.uuid, &conn).await {
            Some(row) if row.request_hash == request_hash => reply(Status::Ok, row.to_json()),
            Some(row) => conflict("revision_mismatch", row.revision, None),
            None => Err(error),
        },
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AnswerData {
    revision: i32,
    answer: String,
}
#[put("/agent/requests/<request_id>/answer", data = "<data>")]
async fn put_answer(request_id: AgentRequestId, data: Json<AnswerData>, headers: Headers, conn: DbConn) -> Reply {
    account_transaction(&headers, &conn, put_answer_inner(request_id, data, &headers, &conn)).await
}
async fn put_answer_inner(
    request_id: AgentRequestId,
    data: Json<AnswerData>,
    headers: &Headers,
    conn: &DbConn,
) -> Reply {
    let d = data.into_inner();
    ciphertext(&d.answer)?;
    let Some(row) = AgentRequest::find(&request_id, &headers.user.uuid, &conn).await else {
        return Err(Error::new_msg("not_found").with_code(404));
    };
    if d.revision < 0 {
        return Err(invalid());
    }
    let pairing = AgentPairing::find(&row.pairing_uuid.clone().into(), &headers.user.uuid, &conn)
        .await
        .ok_or_else(|| Error::new_msg("unpaired").with_code(404))?;
    if pairing.revoked_at.is_some() {
        return Err(Error::new_msg("pairing_revoked").with_code(409));
    }
    request_sources(&row, &headers, &conn).await?;
    if let Some(winner) =
        AgentRequest::cas_answer(&request_id, &headers.user.uuid, d.revision, &d.answer, &conn).await?
    {
        return reply(Status::Ok, winner.to_json());
    }
    AgentRequest::cas_expire(&request_id, &headers.user.uuid, &conn).await?;
    let current = AgentRequest::find(&request_id, &headers.user.uuid, &conn).await.ok_or_else(invalid)?;
    if current.answer.is_none() && current.deadline <= Utc::now().naive_utc() {
        return reply(
            Status::Conflict,
            json!({"message":"deadline_passed","code":"deadline_passed","status":"timed_out","revision":current.answer_revision,"answer":current.answer}),
        );
    }
    conflict("already_resolved", current.answer_revision, current.answer.as_deref())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ResultData {
    revision: i32,
    result: String,
}
#[put("/agent/requests/<request_id>/result", data = "<data>")]
async fn put_result(request_id: AgentRequestId, data: Json<ResultData>, headers: Headers, conn: DbConn) -> Reply {
    account_transaction(&headers, &conn, put_result_inner(request_id, data, &headers, &conn)).await
}
async fn put_result_inner(
    request_id: AgentRequestId,
    data: Json<ResultData>,
    headers: &Headers,
    conn: &DbConn,
) -> Reply {
    let d = data.into_inner();
    ciphertext(&d.result)?;
    if d.revision < 0 {
        return Err(invalid());
    }
    let Some(row) = AgentRequest::find(&request_id, &headers.user.uuid, &conn).await else {
        return Err(Error::new_msg("not_found").with_code(404));
    };
    if row.executor_device_id != headers.device.uuid {
        return reply(Status::Forbidden, json!({"message":"not_executor","code":"not_executor"}));
    }
    match AgentRequest::cas_result(&request_id, &headers.user.uuid, &headers.device.uuid, d.revision, &d.result, &conn)
        .await?
    {
        ResultOutcome::Written | ResultOutcome::Identical => reply(
            Status::Ok,
            AgentRequest::find(&request_id, &headers.user.uuid, &conn).await.ok_or_else(invalid)?.to_json(),
        ),
        ResultOutcome::NotExecutor => reply(Status::Forbidden, json!({"message":"not_executor","code":"not_executor"})),
        ResultOutcome::Conflict => {
            let current = AgentRequest::find(&request_id, &headers.user.uuid, &conn).await.ok_or_else(invalid)?;
            conflict("already_resolved", current.result_revision, None)
        }
        ResultOutcome::Missing => Err(Error::new_msg("not_found").with_code(404)),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct GrantData {
    grant_id: Option<AgentGrantId>,
    source_cipher_id: Option<CipherId>,
    encrypted_grant: String,
    revision: i32,
    revoked_at: Option<String>,
}
#[post("/agent/grants", data = "<data>")]
async fn post_grant(data: Json<GrantData>, headers: Headers, conn: DbConn) -> Reply {
    let d = data.into_inner();
    let grant_id = d.grant_id.clone().ok_or_else(invalid)?;
    save_grant(grant_id, d, &headers, &conn).await
}
#[put("/agent/grants/<grant_id>", data = "<data>")]
async fn put_grant(grant_id: AgentGrantId, data: Json<GrantData>, headers: Headers, conn: DbConn) -> Reply {
    save_grant(grant_id, data.into_inner(), &headers, &conn).await
}
async fn save_grant(grant_id: AgentGrantId, d: GrantData, headers: &Headers, conn: &DbConn) -> Reply {
    account_transaction(headers, conn, save_grant_inner(grant_id, d, headers, conn)).await
}
async fn save_grant_inner(grant_id: AgentGrantId, d: GrantData, headers: &Headers, conn: &DbConn) -> Reply {
    ciphertext(&d.encrypted_grant)?;
    id(grant_id.as_ref())?;
    if d.revision < 0 || d.grant_id.as_ref().is_some_and(|id| id != &grant_id) {
        return Err(invalid());
    }
    let existing = AgentGrant::find(&grant_id, &headers.user.uuid, conn).await;
    if existing.as_ref().map_or(0, |r| r.revision) != d.revision {
        return conflict("revision_mismatch", existing.map_or(0, |r| r.revision), None);
    }
    let source_id = d
        .source_cipher_id
        .or_else(|| existing.as_ref().and_then(|r| r.source_cipher_uuid.clone()))
        .ok_or_else(invalid)?;
    source(&source_id, headers, conn).await?;
    if existing.as_ref().is_some_and(|r| r.source_cipher_uuid.as_ref() != Some(&source_id)) {
        return Err(invalid());
    }
    let ts = Utc::now().naive_utc();
    let mut row = AgentGrant {
        uuid: grant_id.clone(),
        user_uuid: headers.user.uuid.clone(),
        source_cipher_uuid: Some(source_id),
        encrypted_grant: d.encrypted_grant,
        revoked_at: parse_date(d.revoked_at.as_deref())?.map(|_| ts),
        revision: 0,
        updated_at: ts,
        created_at: existing.as_ref().map_or(ts, |r| r.created_at),
    };
    let result = commit_agent_change(conn, move |c, revision| {
        row.revision = revision;
        let changed = if existing.is_some() {
            diesel::update(
                agent_grants::table
                    .filter(agent_grants::uuid.eq(&row.uuid))
                    .filter(agent_grants::user_uuid.eq(&row.user_uuid))
                    .filter(agent_grants::revision.eq(d.revision)),
            )
            .set(&row)
            .execute(c)?
        } else {
            diesel::insert_into(agent_grants::table).values(&row).execute(c)?
        };
        Ok((changed, row))
    })
    .await;
    match result {
        Ok((1, row)) => reply(Status::Ok, row.to_json()),
        other => match AgentGrant::find(&grant_id, &headers.user.uuid, conn).await {
            Some(row) => conflict("revision_mismatch", row.revision, None),
            None => match other {
                Err(error) => Err(error),
                _ => conflict("revision_mismatch", 0, None),
            },
        },
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ActivityData {
    kind: String,
    request_id: Option<AgentRequestId>,
    source_cipher_id: Option<CipherId>,
    source_organization_id: Option<OrganizationId>,
    source_revision: Option<i64>,
    entry_id: Option<String>,
    event_id: Option<String>,
    encrypted_activity: String,
}
#[post("/agent/activity", data = "<data>")]
async fn post_activity(data: Json<ActivityData>, headers: Headers, conn: DbConn) -> Reply {
    account_transaction(&headers, &conn, post_activity_inner(data, &headers, &conn)).await
}
async fn post_activity_inner(data: Json<ActivityData>, headers: &Headers, conn: &DbConn) -> Reply {
    let d = data.into_inner();
    ciphertext(&d.encrypted_activity)?;
    let organization = if let Some(cipher) = &d.source_cipher_id {
        let source = source(cipher, &headers, &conn).await?;
        if d.source_revision != Some(source.revision) || d.source_organization_id != source.organization_uuid {
            return reply(Status::Conflict, json!({"code":"source_changed","message":"source_changed"}));
        }
        source.organization_uuid.map(|o| o.to_string())
    } else {
        None
    };
    let existing = match d.kind.as_str() {
        "fill" => {
            if d.event_id.is_some() {
                return Err(invalid());
            }
            let request = d.request_id.as_ref().ok_or_else(invalid)?;
            let source_id = d.source_cipher_id.as_ref().ok_or_else(invalid)?;
            let entry = d.entry_id.as_deref().filter(|s| !s.is_empty() && s.len() <= 64).ok_or_else(invalid)?;
            let row = AgentRequest::find(request, &headers.user.uuid, &conn)
                .await
                .ok_or_else(|| Error::new_msg("not_found").with_code(404))?;
            if row.executor_device_id != headers.device.uuid {
                return reply(Status::Forbidden, json!({"code":"not_executor","message":"not_executor"}));
            }
            if !serde_json::from_str::<Vec<CipherId>>(&row.cipher_ids)?.contains(source_id) {
                return Err(invalid());
            }
            AgentActivity::find_fill(&headers.user.uuid, request.as_ref(), source_id.as_ref(), entry, &conn).await
        }
        "proxy" => {
            if d.request_id.is_some() || d.entry_id.is_some() {
                return Err(invalid());
            }
            let event = d.event_id.as_deref().ok_or_else(invalid)?;
            id(event)?;
            AgentActivity::find_proxy(&headers.user.uuid, event, &conn).await
        }
        _ => return Err(invalid()),
    };
    if let Some(existing) = existing {
        if existing.encrypted_activity != d.encrypted_activity {
            return conflict("already_resolved", existing.revision, None);
        }
        return reply(Status::Ok, existing.to_json());
    }
    let identity = serde_json::to_vec(&json!([
        headers.user.uuid,
        d.kind,
        d.request_id,
        d.source_cipher_id.as_ref().filter(|_| d.kind == "fill"),
        d.entry_id,
        d.event_id
    ]))?;
    let digest = ring::digest::digest(&ring::digest::SHA256, &identity);
    let mut bytes: [u8; 16] = digest.as_ref()[..16].try_into().map_err(|_| invalid())?;
    bytes[6] = (bytes[6] & 0x0f) | 0x80;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    let activity_id = uuid::Uuid::from_bytes(bytes).to_string();
    let retired = conn
        .run(|c| {
            crate::db::schema::agent_tombstones::table
                .filter(crate::db::schema::agent_tombstones::user_uuid.eq(&headers.user.uuid))
                .filter(crate::db::schema::agent_tombstones::kind.eq("activity"))
                .filter(crate::db::schema::agent_tombstones::row_uuid.eq(&activity_id))
                .first::<AgentTombstone>(c)
                .optional()
        })
        .await?;
    if let Some(retired) = retired {
        return reply(
            Status::Ok,
            json!({"activityId":activity_id,"retained":false,"revision":retired.revision,"object":"agentActivityReceipt"}),
        );
    }
    let row = AgentActivity {
        uuid: activity_id.into(),
        user_uuid: headers.user.uuid.clone(),
        kind: d.kind,
        request_uuid: d.request_id.map(|v| v.to_string()),
        source_cipher_uuid: d.source_cipher_id.map(|v| v.to_string()),
        entry_id: d.entry_id,
        event_id: d.event_id,
        encrypted_activity: d.encrypted_activity,
        revision: 0,
        created_at: Utc::now().naive_utc(),
        organization_uuid: organization,
    };
    let saved = row.clone();
    let result = commit_agent_change(&conn, move |c, revision| {
        let mut saved = saved;
        saved.revision = revision;
        diesel::insert_into(crate::db::schema::agent_activity::table).values(&saved).execute(c)?;
        Ok(saved)
    })
    .await;
    match result {
        Ok(saved) => {
            AgentActivity::enforce_retention(&saved, &conn).await?;
            reply(Status::Ok, saved.to_json())
        }
        Err(error) => {
            let winner = if row.kind == "fill" {
                AgentActivity::find_fill(
                    &headers.user.uuid,
                    row.request_uuid.as_deref().ok_or_else(invalid)?,
                    row.source_cipher_uuid.as_deref().ok_or_else(invalid)?,
                    row.entry_id.as_deref().ok_or_else(invalid)?,
                    &conn,
                )
                .await
            } else {
                AgentActivity::find_proxy(&headers.user.uuid, row.event_id.as_deref().ok_or_else(invalid)?, &conn).await
            };
            match winner {
                Some(saved) if saved.encrypted_activity == row.encrypted_activity => reply(Status::Ok, saved.to_json()),
                Some(saved) => conflict("already_resolved", saved.revision, None),
                None => Err(error),
            }
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BindingData {
    binding_id: FormBindingId,
    encrypted_binding: String,
    revision: i32,
    profile_cipher_id: Option<CipherId>,
}
#[get("/form-bindings")]
async fn get_bindings(headers: Headers, conn: DbConn) -> JsonResult {
    account_transaction(&headers, &conn, async {
        let rows = conn
            .run(|c| {
                form_bindings::table.filter(form_bindings::user_uuid.eq(&headers.user.uuid)).load::<FormBinding>(c)
            })
            .await?;
        let mut visible = Vec::new();
        for row in rows {
            if let Some(cipher) = &row.profile_cipher_uuid {
                if source(cipher, &headers, &conn).await.is_err() {
                    continue;
                }
            }
            visible.push(row.to_json());
        }
        Ok(Json(json!({"data":visible,"object":"list"})))
    })
    .await
}
#[put("/form-bindings", data = "<data>")]
async fn put_binding(data: Json<BindingData>, headers: Headers, conn: DbConn) -> Reply {
    save_binding(data.into_inner(), &headers, &conn).await
}
#[put("/form-bindings/<binding_id>", data = "<data>")]
async fn put_binding_id(binding_id: FormBindingId, data: Json<BindingData>, headers: Headers, conn: DbConn) -> Reply {
    let d = data.into_inner();
    if d.binding_id != binding_id {
        return Err(invalid());
    }
    save_binding(d, &headers, &conn).await
}
async fn save_binding(d: BindingData, headers: &Headers, conn: &DbConn) -> Reply {
    account_transaction(headers, conn, save_binding_inner(d, headers, conn)).await
}
async fn save_binding_inner(d: BindingData, headers: &Headers, conn: &DbConn) -> Reply {
    ciphertext(&d.encrypted_binding)?;
    id(d.binding_id.as_ref())?;
    if d.revision < 0 {
        return Err(invalid());
    }
    if let Some(cipher) = &d.profile_cipher_id {
        if source(cipher, headers, conn).await?.atype != 4 {
            return Err(invalid());
        }
    }
    let existing = FormBinding::find(&d.binding_id, &headers.user.uuid, conn).await;
    if existing.as_ref().map_or(0, |r| r.revision) != d.revision {
        return conflict("revision_mismatch", existing.map_or(0, |r| r.revision), None);
    }
    let ts = Utc::now().naive_utc();
    let binding_id = d.binding_id.clone();
    let mut row = FormBinding {
        uuid: d.binding_id,
        user_uuid: headers.user.uuid.clone(),
        profile_cipher_uuid: d.profile_cipher_id,
        encrypted_binding: d.encrypted_binding,
        revision: 0,
        updated_at: ts,
        created_at: existing.as_ref().map_or(ts, |r| r.created_at),
    };
    let result = commit_agent_change(conn, move |c, revision| {
        row.revision = revision;
        let changed = if existing.is_some() {
            diesel::update(
                form_bindings::table
                    .filter(form_bindings::uuid.eq(&row.uuid))
                    .filter(form_bindings::user_uuid.eq(&row.user_uuid))
                    .filter(form_bindings::revision.eq(d.revision)),
            )
            .set(&row)
            .execute(c)?
        } else {
            diesel::insert_into(form_bindings::table).values(&row).execute(c)?
        };
        Ok((changed, row))
    })
    .await;
    match result {
        Ok((1, row)) => reply(Status::Ok, row.to_json()),
        other => match FormBinding::find(&binding_id, &headers.user.uuid, conn).await {
            Some(row) => conflict("revision_mismatch", row.revision, None),
            None => match other {
                Err(error) => Err(error),
                _ => conflict("revision_mismatch", 0, None),
            },
        },
    }
}
#[delete("/form-bindings/<binding_id>?<revision>")]
async fn delete_binding(binding_id: FormBindingId, revision: i32, headers: Headers, conn: DbConn) -> Reply {
    account_transaction(&headers, &conn, async {
        let row = FormBinding::find(&binding_id, &headers.user.uuid, &conn)
            .await
            .ok_or_else(|| Error::new_msg("not_found").with_code(404))?;
        if row.revision != revision {
            return conflict("revision_mismatch", row.revision, None);
        }
        row.delete_cas(revision, &conn).await?;
        reply(Status::Ok, json!({"bindingId":binding_id,"deleted":true}))
    })
    .await
}

pub async fn sync_value(headers: &Headers, since: i32, conn: &DbConn) -> Result<Value, Error> {
    if since < 0 {
        return Err(invalid());
    }
    account_transaction(headers, conn, scoped_snapshot(headers, since, conn)).await
}
async fn scoped_snapshot(headers: &Headers, since: i32, conn: &DbConn) -> Result<Value, Error> {
    AgentRequest::expire_due(conn).await;
    AgentActivity::delete_older_than(90, conn).await;
    let user = headers.user.uuid.clone();
    let (revision, pairings, requests, grants, bindings, mut activity, tombstones) = conn
        .run(move |c| {
            Ok::<_, Error>((
                crate::db::schema::agent_revision::table
                    .select(crate::db::schema::agent_revision::revision)
                    .first::<i32>(c)?,
                agent_pairings::table.filter(agent_pairings::user_uuid.eq(&user)).load::<AgentPairing>(c)?,
                agent_requests::table.filter(agent_requests::user_uuid.eq(&user)).load::<AgentRequest>(c)?,
                agent_grants::table.filter(agent_grants::user_uuid.eq(&user)).load::<AgentGrant>(c)?,
                form_bindings::table.filter(form_bindings::user_uuid.eq(&user)).load::<FormBinding>(c)?,
                crate::db::schema::agent_activity::table
                    .filter(crate::db::schema::agent_activity::user_uuid.eq(&user))
                    .load::<AgentActivity>(c)?,
                crate::db::schema::agent_tombstones::table
                    .filter(crate::db::schema::agent_tombstones::user_uuid.eq(&user))
                    .filter(crate::db::schema::agent_tombstones::revision.gt(since))
                    .load::<AgentTombstone>(c)?,
            ))
        })
        .await?;
    for cipher in Cipher::find_by_user_visible(&headers.user.uuid, conn).await {
        if cipher.organization_uuid.is_some() {
            for row in AgentActivity::for_cipher(cipher.uuid.as_ref(), conn).await {
                if row.organization_uuid.as_deref() == cipher.organization_uuid.as_ref().map(|o| o.as_ref().as_str())
                    && !activity.iter().any(|a| a.uuid == row.uuid)
                {
                    activity.push(row);
                }
            }
        }
    }
    let mut visible = Vec::new();
    for row in activity {
        if row.organization_uuid.is_none() && row.user_uuid != headers.user.uuid {
            continue;
        }
        if let Some(cipher_id) = &row.source_cipher_uuid {
            let Ok(cipher) = source(&cipher_id.clone().into(), headers, conn).await else {
                continue;
            };
            if row.organization_uuid.is_some()
                && row.organization_uuid.as_deref()
                    != cipher.organization_uuid.as_ref().map(|org| org.as_ref().as_str())
            {
                continue;
            }
        } else if row.user_uuid != headers.user.uuid {
            continue;
        }
        visible.push(row.to_json());
    }
    let mut visible_grants = Vec::new();
    for row in grants {
        if let Some(cipher) = &row.source_cipher_uuid {
            if source(cipher, headers, conn).await.is_err() {
                continue;
            }
        }
        visible_grants.push(row.to_json());
    }
    let mut visible_bindings = Vec::new();
    for row in bindings {
        if let Some(cipher) = &row.profile_cipher_uuid {
            if source(cipher, headers, conn).await.is_err() {
                continue;
            }
        }
        visible_bindings.push(row.to_json());
    }
    Ok(json!({"revision":revision,"fullSnapshot":true,
        "pairings":pairings.iter().map(AgentPairing::to_json).collect::<Vec<_>>(),
        "requests":requests.iter().map(AgentRequest::to_json).collect::<Vec<_>>(),
        "grants":visible_grants,
        "activity":visible,"formBindings":visible_bindings,
        "tombstones":tombstones.iter().map(AgentTombstone::to_json).collect::<Vec<_>>() }))
}
#[get("/agent/sync?<since>")]
async fn sync(since: Option<i32>, headers: Headers, conn: DbConn) -> JsonResult {
    Ok(Json(sync_value(&headers, since.unwrap_or(0), &conn).await?))
}
#[get("/agent/export")]
async fn export(headers: Headers, conn: DbConn) -> JsonResult {
    Ok(Json(sync_value(&headers, 0, &conn).await?))
}
pub async fn purge_agent_records(pool: DbPool) {
    if let Ok(conn) = pool.get().await {
        AgentRequest::expire_due(&conn).await;
        AgentActivity::delete_older_than(90, &conn).await;
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ActivityRotation {
    id: AgentActivityId,
    revision: i32,
    encrypted_activity: String,
}
#[put("/organizations/<org_id>/agent/activity/rotate", data = "<data>")]
async fn rotate_org_activity(
    org_id: OrganizationId,
    data: Json<Vec<ActivityRotation>>,
    headers: OwnerHeaders,
    conn: DbConn,
) -> Reply {
    if org_id != headers.org_id {
        return Err(Error::new_msg("not_found").with_code(404));
    }
    let rows = data.into_inner();
    let ids = rows.iter().map(|r| r.id.clone()).collect::<std::collections::HashSet<_>>();
    if ids.len() != rows.len() {
        return Err(invalid());
    }
    for row in &rows {
        ciphertext(&row.encrypted_activity)?;
    }
    commit_agent_change(&conn, move |c, revision| {
        use crate::db::schema::agent_activity as a;
        let count = a::table.filter(a::organization_uuid.eq(org_id.as_ref())).count().get_result::<i64>(c)?;
        if count != rows.len() as i64 {
            return Err(Error::new_msg("revision_mismatch").with_code(409));
        }
        for row in rows {
            let changed = diesel::update(
                a::table
                    .filter(a::uuid.eq(row.id))
                    .filter(a::organization_uuid.eq(org_id.as_ref()))
                    .filter(a::revision.eq(row.revision)),
            )
            .set((a::encrypted_activity.eq(row.encrypted_activity), a::revision.eq(revision)))
            .execute(c)?;
            if changed != 1 {
                return Err(Error::new_msg("revision_mismatch").with_code(409));
            }
        }
        Ok(())
    })
    .await?;
    reply(Status::Ok, json!({"revision":current_agent_revision(&conn).await}))
}

pub async fn organization_activity(org: &OrganizationId, conn: &DbConn) -> Result<Vec<Value>, Error> {
    use crate::db::schema::agent_activity as a;
    Ok(conn
        .run(move |c| a::table.filter(a::organization_uuid.eq(org.as_ref())).load::<AgentActivity>(c))
        .await?
        .iter()
        .map(AgentActivity::to_json)
        .collect())
}

#[get("/agent/rotation")]
async fn rotation_records(headers: Headers, conn: DbConn) -> JsonResult {
    account_transaction(&headers, &conn, async {
        Ok(Json(super::agent_rotation::export_private(&headers.user.uuid, &conn).await?))
    })
    .await
}
