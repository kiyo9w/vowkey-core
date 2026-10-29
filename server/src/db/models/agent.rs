use chrono::{NaiveDateTime, TimeDelta, Utc};
use derive_more::{AsRef, Deref, Display, From};
use diesel::prelude::*;
use serde_json::Value;

use crate::{
    api::EmptyResult,
    db::{
        DbConn,
        schema::{
            agent_activity, agent_grants, agent_pairings, agent_requests, agent_revision, agent_tombstones,
            form_bindings, guest_decision_use, guest_installations, migration_maps,
        },
    },
    error::MapResult,
    util::format_date,
};
use macros::UuidFromParam;

use super::{CipherId, DeviceId, UserId};

pub const REQUEST_WINDOW_SECS: i64 = 600;
pub const ACTIVITY_RETAIN_DAYS: i64 = 90;
pub const FILL_CAP: i64 = 200;
pub const PROXY_CAP: i64 = 2_000;

#[derive(
    Clone,
    Debug,
    AsRef,
    Deref,
    Display,
    From,
    PartialEq,
    Eq,
    Hash,
    DieselNewType,
    Serialize,
    Deserialize,
    FromForm,
    UuidFromParam,
)]
pub struct AgentPairingId(pub String);
#[derive(
    Clone,
    Debug,
    AsRef,
    Deref,
    Display,
    From,
    PartialEq,
    Eq,
    Hash,
    DieselNewType,
    Serialize,
    Deserialize,
    FromForm,
    UuidFromParam,
)]
pub struct AgentRequestId(pub String);
#[derive(
    Clone,
    Debug,
    AsRef,
    Deref,
    Display,
    From,
    PartialEq,
    Eq,
    Hash,
    DieselNewType,
    Serialize,
    Deserialize,
    FromForm,
    UuidFromParam,
)]
pub struct AgentGrantId(pub String);
#[derive(
    Clone,
    Debug,
    AsRef,
    Deref,
    Display,
    From,
    PartialEq,
    Eq,
    Hash,
    DieselNewType,
    Serialize,
    Deserialize,
    FromForm,
    UuidFromParam,
)]
pub struct AgentActivityId(pub String);
#[derive(
    Clone,
    Debug,
    AsRef,
    Deref,
    Display,
    From,
    PartialEq,
    Eq,
    Hash,
    DieselNewType,
    Serialize,
    Deserialize,
    FromForm,
    UuidFromParam,
)]
pub struct FormBindingId(pub String);

#[derive(Clone, Identifiable, Queryable, Insertable, AsChangeset)]
#[diesel(table_name = agent_pairings)]
#[diesel(treat_none_as_null = true)]
#[diesel(primary_key(uuid))]
pub struct AgentPairing {
    pub uuid: AgentPairingId,
    pub user_uuid: UserId,
    pub local_executor_id: String,
    pub executor_device_id: Option<DeviceId>,
    pub encrypted_metadata: String,
    pub revoked_at: Option<NaiveDateTime>,
    pub revision: i32,
    pub updated_at: NaiveDateTime,
    pub created_at: NaiveDateTime,
}

#[derive(Clone, Identifiable, Queryable, Insertable, AsChangeset)]
#[diesel(table_name = agent_requests)]
#[diesel(treat_none_as_null = true)]
#[diesel(primary_key(uuid))]
pub struct AgentRequest {
    pub uuid: AgentRequestId,
    pub user_uuid: UserId,
    pub pairing_uuid: String,
    pub executor_device_id: DeviceId,
    pub cipher_ids: String,
    pub routing: String,
    pub note: Option<String>,
    pub answer: Option<String>,
    pub result: Option<String>,
    pub status: String,
    pub received_at: NaiveDateTime,
    pub deadline: NaiveDateTime,
    pub answer_revision: i32,
    pub result_revision: i32,
    pub revision: i32,
    pub updated_at: NaiveDateTime,
    pub request_hash: String,
}

#[derive(Clone, Identifiable, Queryable, Insertable, AsChangeset)]
#[diesel(table_name = agent_grants)]
#[diesel(treat_none_as_null = true)]
#[diesel(primary_key(uuid))]
pub struct AgentGrant {
    pub uuid: AgentGrantId,
    pub user_uuid: UserId,
    pub source_cipher_uuid: Option<CipherId>,
    pub encrypted_grant: String,
    pub revoked_at: Option<NaiveDateTime>,
    pub revision: i32,
    pub updated_at: NaiveDateTime,
    pub created_at: NaiveDateTime,
}

#[derive(Clone, Identifiable, Queryable, Insertable, AsChangeset)]
#[diesel(table_name = agent_activity)]
#[diesel(treat_none_as_null = true)]
#[diesel(primary_key(uuid))]
pub struct AgentActivity {
    pub uuid: AgentActivityId,
    pub user_uuid: UserId,
    pub kind: String,
    pub request_uuid: Option<String>,
    pub source_cipher_uuid: Option<String>,
    pub entry_id: Option<String>,
    pub event_id: Option<String>,
    pub encrypted_activity: String,
    pub revision: i32,
    pub created_at: NaiveDateTime,
    pub organization_uuid: Option<String>,
}

#[derive(Clone, Identifiable, Queryable, Insertable, AsChangeset)]
#[diesel(table_name = form_bindings)]
#[diesel(treat_none_as_null = true)]
#[diesel(primary_key(uuid))]
pub struct FormBinding {
    pub uuid: FormBindingId,
    pub user_uuid: UserId,
    pub profile_cipher_uuid: Option<CipherId>,
    pub encrypted_binding: String,
    pub revision: i32,
    pub updated_at: NaiveDateTime,
    pub created_at: NaiveDateTime,
}

#[derive(Clone, Identifiable, Queryable, Insertable, AsChangeset)]
#[diesel(table_name = agent_tombstones)]
#[diesel(primary_key(uuid))]
pub struct AgentTombstone {
    pub uuid: String,
    pub user_uuid: UserId,
    pub kind: String,
    pub row_uuid: String,
    pub revision: i32,
    pub deleted_at: NaiveDateTime,
}

#[derive(Clone, Queryable, Insertable, AsChangeset)]
#[diesel(table_name = migration_maps)]
#[diesel(treat_none_as_null = true)]
#[diesel(primary_key(user_uuid, migration_id, resource_kind, parent_key, local_resource_id))]
pub struct MigrationMap {
    pub user_uuid: UserId,
    pub migration_id: String,
    pub resource_kind: String,
    pub parent_key: String,
    pub local_resource_id: String,
    pub remote_id: String,
    pub request_hash: String,
    pub bytes_checksum: Option<String>,
    pub gone: bool,
    pub created_at: NaiveDateTime,
}

fn now() -> NaiveDateTime {
    Utc::now().naive_utc()
}

async fn touch(user_uuid: &UserId, conn: &DbConn) {
    super::User::update_uuid_revision(user_uuid, conn).await;
}

impl AgentPairing {
    pub fn new(
        uuid: AgentPairingId,
        user_uuid: UserId,
        local_executor_id: String,
        executor_device_id: Option<DeviceId>,
        encrypted_metadata: String,
    ) -> Self {
        let ts = now();
        Self {
            uuid,
            user_uuid,
            local_executor_id,
            executor_device_id,
            encrypted_metadata,
            revoked_at: None,
            revision: 1,
            updated_at: ts,
            created_at: ts,
        }
    }

    pub fn to_json(&self) -> Value {
        json!({
            "pairingId": self.uuid,
            "localExecutorId": self.local_executor_id,
            "executorDeviceId": self.executor_device_id,
            "encryptedMetadata": self.encrypted_metadata,
            "revokedAt": self.revoked_at.map(|d| format_date(&d)),
            "revision": self.revision,
            "createdAt": format_date(&self.created_at),
            "updatedAt": format_date(&self.updated_at),
            "object": "agentPairing",
        })
    }

    pub async fn save(&self, conn: &DbConn) -> EmptyResult {
        touch(&self.user_uuid, conn).await;
        db_run! { conn:
            mysql {
                diesel::insert_into(agent_pairings::table).values(self)
                    .on_conflict(diesel::dsl::DuplicatedKeys).do_update().set(self)
                    .execute(conn).map_res("Error saving agent pairing")
            }
            postgresql, sqlite {
                diesel::insert_into(agent_pairings::table).values(self)
                    .on_conflict(agent_pairings::uuid).do_update().set(self)
                    .execute(conn).map_res("Error saving agent pairing")
            }
        }
    }

    pub async fn find(uuid: &AgentPairingId, user: &UserId, conn: &DbConn) -> Option<Self> {
        let uuid = uuid.clone();
        let user = user.clone();
        conn.run(move |conn| {
            agent_pairings::table
                .filter(agent_pairings::uuid.eq(uuid))
                .filter(agent_pairings::user_uuid.eq(user))
                .first::<Self>(conn)
                .ok()
        })
        .await
    }

    pub async fn find_by_user_since(user: &UserId, since: i32, conn: &DbConn) -> Vec<Self> {
        let user = user.clone();
        conn.run(move |conn| {
            agent_pairings::table
                .filter(agent_pairings::user_uuid.eq(user))
                .filter(agent_pairings::revision.gt(since))
                .load::<Self>(conn)
                .unwrap_or_default()
        })
        .await
    }

    pub async fn find_by_user(user: &UserId, conn: &DbConn) -> Vec<Self> {
        Self::find_by_user_since(user, 0, conn).await
    }

    pub async fn delete_all_by_user(user: &UserId, conn: &DbConn) -> EmptyResult {
        let user = user.clone();
        conn.run(move |conn| {
            diesel::delete(agent_pairings::table.filter(agent_pairings::user_uuid.eq(user)))
                .execute(conn)
                .map_res("Error deleting agent pairings")
        })
        .await
    }
}

impl AgentRequest {
    pub fn new(
        uuid: AgentRequestId,
        user_uuid: UserId,
        pairing_uuid: String,
        executor_device_id: DeviceId,
        cipher_ids: String,
        routing: String,
        note: Option<String>,
    ) -> Self {
        let received = now();
        Self {
            uuid,
            user_uuid,
            pairing_uuid,
            executor_device_id,
            cipher_ids,
            routing,
            note,
            answer: None,
            result: None,
            status: "pending".to_owned(),
            received_at: received,
            deadline: received + TimeDelta::try_seconds(REQUEST_WINDOW_SECS).unwrap(),
            answer_revision: 0,
            result_revision: 0,
            revision: 1,
            updated_at: received,
            request_hash: String::new(),
        }
    }

    pub fn to_json(&self) -> Value {
        json!({
            "requestId": self.uuid,
            "pairingId": self.pairing_uuid,
            "executorDeviceId": self.executor_device_id,
            "cipherIds": serde_json::from_str::<Value>(&self.cipher_ids).unwrap_or(Value::Null),
            "routing": self.routing,
            "note": self.note,
            "answer": self.answer,
            "result": self.result,
            "status": self.status,
            "receivedAt": format_date(&self.received_at),
            "deadline": format_date(&self.deadline),
            "answerRevision": self.answer_revision,
            "resultRevision": self.result_revision,
            "revision": self.revision,
            "object": "agentRequest",
        })
    }

    pub async fn save(&self, conn: &DbConn) -> EmptyResult {
        touch(&self.user_uuid, conn).await;
        db_run! { conn:
            mysql {
                diesel::insert_into(agent_requests::table).values(self)
                    .on_conflict(diesel::dsl::DuplicatedKeys).do_update().set(self)
                    .execute(conn).map_res("Error saving agent request")
            }
            postgresql, sqlite {
                diesel::insert_into(agent_requests::table).values(self)
                    .on_conflict(agent_requests::uuid).do_update().set(self)
                    .execute(conn).map_res("Error saving agent request")
            }
        }
    }

    pub async fn find(uuid: &AgentRequestId, user: &UserId, conn: &DbConn) -> Option<Self> {
        let uuid = uuid.clone();
        let user = user.clone();
        conn.run(move |conn| {
            agent_requests::table
                .filter(agent_requests::uuid.eq(uuid))
                .filter(agent_requests::user_uuid.eq(user))
                .first::<Self>(conn)
                .ok()
        })
        .await
    }

    pub async fn find_by_user_since(user: &UserId, since: i32, conn: &DbConn) -> Vec<Self> {
        let user = user.clone();
        conn.run(move |conn| {
            agent_requests::table
                .filter(agent_requests::user_uuid.eq(user))
                .filter(agent_requests::revision.gt(since))
                .load::<Self>(conn)
                .unwrap_or_default()
        })
        .await
    }

    pub async fn find_by_user(user: &UserId, conn: &DbConn) -> Vec<Self> {
        Self::find_by_user_since(user, 0, conn).await
    }

    /// One answer wins. A later answer, or any answer after the deadline, changes nothing.
    pub async fn cas_answer(
        uuid: &AgentRequestId,
        user: &UserId,
        expected: i32,
        answer: &str,
        conn: &DbConn,
    ) -> Result<Option<Self>, crate::Error> {
        let ts = now();
        let id = uuid.clone();
        let owner = user.clone();
        let answer = answer.to_owned();
        let updated = conn
            .run(move |c| {
                c.transaction::<usize, crate::Error, _>(|c| {
                    let revision = allocate_agent_revision(c)?;
                    Ok(diesel::update(
                        agent_requests::table
                            .filter(agent_requests::uuid.eq(id))
                            .filter(agent_requests::user_uuid.eq(owner))
                            .filter(agent_requests::answer_revision.eq(expected))
                            .filter(agent_requests::answer.is_null())
                            .filter(agent_requests::deadline.gt(ts))
                            .filter(agent_requests::status.eq("pending")),
                    )
                    .set((
                        agent_requests::answer.eq(answer),
                        agent_requests::note.eq(None::<String>),
                        agent_requests::status.eq("answered"),
                        agent_requests::answer_revision.eq(expected + 1),
                        agent_requests::revision.eq(revision),
                        agent_requests::updated_at.eq(ts),
                    ))
                    .execute(c)?)
                })
            })
            .await?;
        if updated == 1 {
            let row = Self::find(uuid, user, conn).await;
            if let Some(row) = &row {
                touch(&row.user_uuid, conn).await;
            }
            Ok(row)
        } else {
            Ok(None)
        }
    }

    /// Expire an unanswered request. An answer or a result already stored is left alone.
    pub async fn cas_expire(uuid: &AgentRequestId, user: &UserId, conn: &DbConn) -> Result<bool, crate::Error> {
        let ts = now();
        let uuid = uuid.clone();
        let user = user.clone();
        conn.run(move |c| {
            c.transaction::<bool, crate::Error, _>(|c| {
                let revision = allocate_agent_revision(c)?;
                Ok(diesel::update(
                    agent_requests::table
                        .filter(agent_requests::uuid.eq(uuid))
                        .filter(agent_requests::user_uuid.eq(user))
                        .filter(agent_requests::answer.is_null())
                        .filter(agent_requests::result.is_null())
                        .filter(agent_requests::status.eq("pending"))
                        .filter(agent_requests::deadline.le(ts)),
                )
                .set((
                    agent_requests::note.eq(None::<String>),
                    agent_requests::status.eq("timed_out"),
                    agent_requests::revision.eq(revision),
                    agent_requests::updated_at.eq(ts),
                ))
                .execute(c)?
                    == 1)
            })
        })
        .await
    }

    /// The executor writes one terminal result. The same ciphertext retries; a different one does not land.
    pub async fn cas_result(
        uuid: &AgentRequestId,
        user: &UserId,
        device: &DeviceId,
        expected: i32,
        result: &str,
        conn: &DbConn,
    ) -> Result<ResultOutcome, crate::Error> {
        let ts = now();
        let id = uuid.clone();
        let owner = user.clone();
        let device_id = device.clone();
        let ciphertext = result.to_owned();
        let updated = conn
            .run(move |c| {
                c.transaction::<usize, crate::Error, _>(|c| {
                    let revision = allocate_agent_revision(c)?;
                    Ok(diesel::update(
                        agent_requests::table
                            .filter(agent_requests::uuid.eq(id))
                            .filter(agent_requests::user_uuid.eq(owner))
                            .filter(agent_requests::executor_device_id.eq(device_id))
                            .filter(agent_requests::result_revision.eq(expected))
                            .filter(agent_requests::result.is_null())
                            .filter(agent_requests::answer.is_not_null().or(agent_requests::status.eq("timed_out"))),
                    )
                    .set((
                        agent_requests::result.eq(ciphertext),
                        agent_requests::note.eq(None::<String>),
                        agent_requests::status.eq("result"),
                        agent_requests::result_revision.eq(expected + 1),
                        agent_requests::revision.eq(revision),
                        agent_requests::updated_at.eq(ts),
                    ))
                    .execute(c)?)
                })
            })
            .await?;
        if updated == 1 {
            touch(user, conn).await;
            return Ok(ResultOutcome::Written);
        }
        match Self::find(uuid, user, conn).await {
            Some(row) if &row.executor_device_id != device => Ok(ResultOutcome::NotExecutor),
            Some(row) if row.result.as_deref() == Some(result) => Ok(ResultOutcome::Identical),
            Some(_) => Ok(ResultOutcome::Conflict),
            None => Ok(ResultOutcome::Missing),
        }
    }

    pub async fn delete_all_by_user(user: &UserId, conn: &DbConn) -> EmptyResult {
        let user = user.clone();
        conn.run(move |conn| {
            diesel::delete(agent_requests::table.filter(agent_requests::user_uuid.eq(user)))
                .execute(conn)
                .map_res("Error deleting agent requests")
        })
        .await
    }

    pub async fn expire_due(conn: &DbConn) {
        let ts = now();
        let rows = conn
            .run(move |c| {
                agent_requests::table
                    .filter(agent_requests::result.is_null())
                    .filter(agent_requests::deadline.le(ts))
                    .filter(agent_requests::status.eq_any(["pending", "answered"]))
                    .load::<Self>(c)
            })
            .await;
        if let Ok(rows) = rows {
            for row in rows {
                if row.answer.is_none() {
                    if Self::cas_expire(&row.uuid, &row.user_uuid, conn).await.is_err() {
                        warn!("Unable to expire an agent request");
                    }
                } else if row.status == "answered" {
                    let expiration = conn
                        .run(move |c| {
                            c.transaction::<usize, crate::Error, _>(|c| {
                                let revision = allocate_agent_revision(c)?;
                                Ok(diesel::update(
                                    agent_requests::table
                                        .filter(agent_requests::uuid.eq(row.uuid))
                                        .filter(agent_requests::status.eq("answered"))
                                        .filter(agent_requests::result.is_null()),
                                )
                                .set((
                                    agent_requests::status.eq("executor_unavailable"),
                                    agent_requests::revision.eq(revision),
                                    agent_requests::updated_at.eq(ts),
                                ))
                                .execute(c)?)
                            })
                        })
                        .await;
                    if expiration.is_err() {
                        warn!("Unable to expire an agent execution");
                    }
                }
            }
        }
        let cutoff = ts - TimeDelta::days(ACTIVITY_RETAIN_DAYS);
        let expired = conn
            .run(move |c| agent_requests::table.filter(agent_requests::received_at.lt(cutoff)).load::<Self>(c))
            .await;
        if let Ok(expired) = expired
            && !expired.is_empty()
        {
            let cleanup = commit_agent_change(conn, move |c, revision| {
                for row in expired {
                    let changed =
                        diesel::delete(agent_requests::table.filter(agent_requests::uuid.eq(&row.uuid))).execute(c)?;
                    if changed == 1 {
                        insert_tombstone(c, row.user_uuid, "request", row.uuid.to_string(), revision)?;
                    }
                }
                Ok(())
            })
            .await;
            if let Err(error) = cleanup {
                error!("Unable to purge expired agent requests: {error}");
            }
        }
        if let Err(error) = conn
            .run(move |c| {
                diesel::delete(agent_tombstones::table.filter(agent_tombstones::deleted_at.lt(cutoff))).execute(c)
            })
            .await
        {
            error!("Unable to purge expired agent tombstones: {error}");
        }
    }
}

pub enum ResultOutcome {
    Written,
    Identical,
    Conflict,
    NotExecutor,
    Missing,
}

impl AgentGrant {
    pub fn to_json(&self) -> Value {
        json!({
            "grantId": self.uuid,
            "sourceCipherId": self.source_cipher_uuid,
            "encryptedGrant": self.encrypted_grant,
            "revokedAt": self.revoked_at.map(|d| format_date(&d)),
            "revision": self.revision,
            "updatedAt": format_date(&self.updated_at),
            "object": "agentGrant",
        })
    }

    pub async fn save(&self, conn: &DbConn) -> EmptyResult {
        touch(&self.user_uuid, conn).await;
        db_run! { conn:
            mysql {
                diesel::insert_into(agent_grants::table).values(self)
                    .on_conflict(diesel::dsl::DuplicatedKeys).do_update().set(self)
                    .execute(conn).map_res("Error saving agent grant")
            }
            postgresql, sqlite {
                diesel::insert_into(agent_grants::table).values(self)
                    .on_conflict(agent_grants::uuid).do_update().set(self)
                    .execute(conn).map_res("Error saving agent grant")
            }
        }
    }

    pub async fn find(uuid: &AgentGrantId, user: &UserId, conn: &DbConn) -> Option<Self> {
        let uuid = uuid.clone();
        let user = user.clone();
        conn.run(move |conn| {
            agent_grants::table
                .filter(agent_grants::uuid.eq(uuid))
                .filter(agent_grants::user_uuid.eq(user))
                .first::<Self>(conn)
                .ok()
        })
        .await
    }

    pub async fn find_by_user(user: &UserId, conn: &DbConn) -> Vec<Self> {
        Self::find_by_user_since(user, 0, conn).await
    }

    pub async fn find_by_user_since(user: &UserId, since: i32, conn: &DbConn) -> Vec<Self> {
        let user = user.clone();
        conn.run(move |conn| {
            agent_grants::table
                .filter(agent_grants::user_uuid.eq(user))
                .filter(agent_grants::revision.gt(since))
                .load::<Self>(conn)
                .unwrap_or_default()
        })
        .await
    }

    pub async fn delete_all_by_user(user: &UserId, conn: &DbConn) -> EmptyResult {
        let user = user.clone();
        conn.run(move |conn| {
            diesel::delete(agent_grants::table.filter(agent_grants::user_uuid.eq(user)))
                .execute(conn)
                .map_res("Error deleting agent grants")
        })
        .await
    }
}

impl AgentActivity {
    pub fn to_json(&self) -> Value {
        json!({
            "id": self.uuid,
            "kind": self.kind,
            "requestId": self.request_uuid,
            "sourceCipherId": self.source_cipher_uuid,
            "entryId": self.entry_id,
            "eventId": self.event_id,
            "encryptedActivity": self.encrypted_activity,
            "revision": self.revision,
            "createdAt": format_date(&self.created_at),
            "organizationId": self.organization_uuid,
            "object": "agentActivity",
        })
    }

    pub async fn find_fill(user: &UserId, request_id: &str, source: &str, entry: &str, conn: &DbConn) -> Option<Self> {
        let user = user.clone();
        let request_id = request_id.to_owned();
        let source = source.to_owned();
        let entry = entry.to_owned();
        conn.run(move |conn| {
            agent_activity::table
                .filter(agent_activity::user_uuid.eq(user))
                .filter(agent_activity::kind.eq("fill"))
                .filter(agent_activity::request_uuid.eq(request_id))
                .filter(agent_activity::source_cipher_uuid.eq(source))
                .filter(agent_activity::entry_id.eq(entry))
                .first::<Self>(conn)
                .ok()
        })
        .await
    }

    pub async fn find_proxy(user: &UserId, event_id: &str, conn: &DbConn) -> Option<Self> {
        let user = user.clone();
        let event_id = event_id.to_owned();
        conn.run(move |conn| {
            agent_activity::table
                .filter(agent_activity::user_uuid.eq(user))
                .filter(agent_activity::kind.eq("proxy"))
                .filter(agent_activity::event_id.eq(event_id))
                .first::<Self>(conn)
                .ok()
        })
        .await
    }

    pub async fn insert(&self, conn: &DbConn) -> EmptyResult {
        touch(&self.user_uuid, conn).await;
        let row = self.clone();
        conn.run(move |conn| {
            diesel::insert_into(agent_activity::table).values(&row).execute(conn).map_res("Error saving agent activity")
        })
        .await
    }

    pub async fn save_ciphertext(&self, conn: &DbConn) -> EmptyResult {
        let row = self.clone();
        conn.run(move |conn| {
            diesel::update(agent_activity::table.filter(agent_activity::uuid.eq(&row.uuid)))
                .set(agent_activity::encrypted_activity.eq(&row.encrypted_activity))
                .execute(conn)
                .map_res("Error rotating agent activity")
        })
        .await
    }

    pub async fn for_user_since(user: &UserId, since: i32, conn: &DbConn) -> Vec<Self> {
        let user = user.clone();
        conn.run(move |conn| {
            agent_activity::table
                .filter(agent_activity::user_uuid.eq(user))
                .filter(agent_activity::revision.gt(since))
                .load::<Self>(conn)
                .unwrap_or_default()
        })
        .await
    }

    pub async fn for_cipher(cipher: &str, conn: &DbConn) -> Vec<Self> {
        let cipher = cipher.to_owned();
        conn.run(move |conn| {
            agent_activity::table
                .filter(agent_activity::source_cipher_uuid.eq(cipher))
                .load::<Self>(conn)
                .unwrap_or_default()
        })
        .await
    }

    pub async fn count_kind(user: &UserId, kind: &str, source: Option<&str>, conn: &DbConn) -> i64 {
        let user = user.clone();
        let kind = kind.to_owned();
        let source = source.map(str::to_owned);
        conn.run(move |conn| {
            let mut q = agent_activity::table
                .filter(agent_activity::user_uuid.eq(user))
                .filter(agent_activity::kind.eq(kind))
                .into_boxed();
            if let Some(source) = source {
                q = q.filter(agent_activity::source_cipher_uuid.eq(source));
            }
            q.count().get_result(conn).unwrap_or(0)
        })
        .await
    }

    pub async fn delete_oldest(user: &UserId, kind: &str, source: Option<&str>, conn: &DbConn) -> EmptyResult {
        let user = user.clone();
        let kind = kind.to_owned();
        let source = source.map(str::to_owned);
        let oldest: Option<String> = conn
            .run(move |conn| {
                let mut q = agent_activity::table
                    .filter(agent_activity::user_uuid.eq(&user))
                    .filter(agent_activity::kind.eq(&kind))
                    .into_boxed();
                if let Some(source) = &source {
                    q = q.filter(agent_activity::source_cipher_uuid.eq(source));
                }
                q.order_by(agent_activity::created_at.asc())
                    .select(agent_activity::uuid)
                    .first::<AgentActivityId>(conn)
                    .ok()
                    .map(|id| id.0)
            })
            .await;
        if let Some(id) = oldest {
            conn.run(move |conn| -> EmptyResult {
                diesel::delete(agent_activity::table.filter(agent_activity::uuid.eq(id)))
                    .execute(conn)
                    .map_res("Error evicting agent activity")
            })
            .await?;
        }
        Ok(())
    }

    pub async fn delete_older_than(days: i64, conn: &DbConn) {
        let cutoff = now() - TimeDelta::try_days(days).unwrap_or_default();
        let rows = conn
            .run(move |c| agent_activity::table.filter(agent_activity::created_at.lt(cutoff)).load::<Self>(c))
            .await;
        if let Ok(rows) = rows {
            for row in rows {
                if let Err(error) = Self::remove(row, conn).await {
                    error!("Unable to purge agent activity: {error}");
                }
            }
        }
    }

    pub async fn delete_all_by_user(user: &UserId, conn: &DbConn) -> EmptyResult {
        let user = user.clone();
        conn.run(move |conn| {
            diesel::delete(agent_activity::table.filter(agent_activity::user_uuid.eq(user)))
                .execute(conn)
                .map_res("Error deleting agent activity")
        })
        .await
    }

    pub async fn delete_by_cipher(cipher: &CipherId, conn: &DbConn) -> EmptyResult {
        let cipher = cipher.to_string();
        conn.run(move |conn| {
            diesel::delete(agent_activity::table.filter(agent_activity::source_cipher_uuid.eq(cipher)))
                .execute(conn)
                .map_res("Error deleting cipher activity")
        })
        .await
    }

    pub async fn enforce_retention(row: &Self, conn: &DbConn) -> EmptyResult {
        let owner = row.user_uuid.clone();
        let kind = row.kind.clone();
        let source = row.source_cipher_uuid.clone();
        let organization = row.organization_uuid.clone();
        let cap = if kind == "fill" {
            FILL_CAP
        } else {
            PROXY_CAP
        };
        let rows = conn
            .run(move |c| {
                let mut q = agent_activity::table.filter(agent_activity::kind.eq(&kind)).into_boxed();
                if kind == "fill" {
                    q = q.filter(agent_activity::source_cipher_uuid.eq(source));
                } else if organization.is_some() {
                    q = q
                        .filter(agent_activity::source_cipher_uuid.eq(source))
                        .filter(agent_activity::organization_uuid.eq(organization));
                } else {
                    q = q
                        .filter(agent_activity::user_uuid.eq(owner))
                        .filter(agent_activity::organization_uuid.is_null());
                }
                q.order((agent_activity::created_at.desc(), agent_activity::uuid.desc()))
                    .limit(i64::MAX)
                    .offset(cap)
                    .load::<Self>(c)
            })
            .await?;
        for evicted in rows {
            Self::remove(evicted, conn).await?;
        }
        Ok(())
    }

    async fn remove(row: Self, conn: &DbConn) -> EmptyResult {
        commit_agent_change(conn, move |c, revision| {
            let changed =
                diesel::delete(agent_activity::table.filter(agent_activity::uuid.eq(&row.uuid))).execute(c)?;
            if changed == 1 {
                diesel::insert_into(agent_tombstones::table)
                    .values(&AgentTombstone {
                        uuid: crate::util::get_uuid(),
                        user_uuid: row.user_uuid,
                        kind: "activity".into(),
                        row_uuid: row.uuid.to_string(),
                        revision,
                        deleted_at: now(),
                    })
                    .execute(c)?;
            }
            Ok(())
        })
        .await
    }
}

impl FormBinding {
    pub fn to_json(&self) -> Value {
        json!({
            "bindingId": self.uuid,
            "profileCipherId": self.profile_cipher_uuid,
            "encryptedBinding": self.encrypted_binding,
            "revision": self.revision,
            "updatedAt": format_date(&self.updated_at),
            "object": "formBinding",
        })
    }

    pub async fn save(&self, conn: &DbConn) -> EmptyResult {
        touch(&self.user_uuid, conn).await;
        db_run! { conn:
            mysql {
                diesel::insert_into(form_bindings::table).values(self)
                    .on_conflict(diesel::dsl::DuplicatedKeys).do_update().set(self)
                    .execute(conn).map_res("Error saving form binding")
            }
            postgresql, sqlite {
                diesel::insert_into(form_bindings::table).values(self)
                    .on_conflict(form_bindings::uuid).do_update().set(self)
                    .execute(conn).map_res("Error saving form binding")
            }
        }
    }

    pub async fn find(uuid: &FormBindingId, user: &UserId, conn: &DbConn) -> Option<Self> {
        let uuid = uuid.clone();
        let user = user.clone();
        conn.run(move |conn| {
            form_bindings::table
                .filter(form_bindings::uuid.eq(uuid))
                .filter(form_bindings::user_uuid.eq(user))
                .first::<Self>(conn)
                .ok()
        })
        .await
    }

    pub async fn find_by_user(user: &UserId, conn: &DbConn) -> Vec<Self> {
        Self::find_by_user_since(user, 0, conn).await
    }

    pub async fn find_by_user_since(user: &UserId, since: i32, conn: &DbConn) -> Vec<Self> {
        let user = user.clone();
        conn.run(move |conn| {
            form_bindings::table
                .filter(form_bindings::user_uuid.eq(user))
                .filter(form_bindings::revision.gt(since))
                .load::<Self>(conn)
                .unwrap_or_default()
        })
        .await
    }

    pub async fn delete(&self, conn: &DbConn) -> EmptyResult {
        touch(&self.user_uuid, conn).await;
        let uuid = self.uuid.clone();
        conn.run(move |conn| {
            diesel::delete(form_bindings::table.filter(form_bindings::uuid.eq(uuid)))
                .execute(conn)
                .map_res("Error deleting form binding")
        })
        .await
    }

    pub async fn delete_cas(&self, expected: i32, conn: &DbConn) -> EmptyResult {
        let row = self.clone();
        conn.run(move |c| {
            c.transaction::<(), crate::Error, _>(|c| {
                let revision = allocate_agent_revision(c)?;
                let changed = diesel::delete(
                    form_bindings::table
                        .filter(form_bindings::uuid.eq(&row.uuid))
                        .filter(form_bindings::user_uuid.eq(&row.user_uuid))
                        .filter(form_bindings::revision.eq(expected)),
                )
                .execute(c)?;
                if changed != 1 {
                    return Err(crate::Error::new_msg("revision_mismatch").with_code(409));
                }
                diesel::insert_into(agent_tombstones::table)
                    .values(&AgentTombstone {
                        uuid: crate::util::get_uuid(),
                        user_uuid: row.user_uuid,
                        kind: "formBinding".into(),
                        row_uuid: row.uuid.to_string(),
                        revision,
                        deleted_at: now(),
                    })
                    .execute(c)?;
                Ok(())
            })
        })
        .await
    }

    pub async fn delete_all_by_user(user: &UserId, conn: &DbConn) -> EmptyResult {
        let user = user.clone();
        conn.run(move |conn| {
            diesel::delete(form_bindings::table.filter(form_bindings::user_uuid.eq(user)))
                .execute(conn)
                .map_res("Error deleting form bindings")
        })
        .await
    }
}

impl AgentTombstone {
    pub async fn record(user: &UserId, kind: &str, row_uuid: &str, revision: i32, conn: &DbConn) -> EmptyResult {
        let row = Self {
            uuid: crate::util::get_uuid(),
            user_uuid: user.clone(),
            kind: kind.to_owned(),
            row_uuid: row_uuid.to_owned(),
            revision,
            deleted_at: now(),
        };
        conn.run(move |conn| {
            diesel::insert_into(agent_tombstones::table).values(&row).execute(conn).map_res("Error saving tombstone")
        })
        .await
    }

    pub fn to_json(&self) -> Value {
        json!({
            "kind": self.kind,
            "id": self.row_uuid,
            "revision": self.revision,
            "deletedAt": format_date(&self.deleted_at),
        })
    }

    pub async fn for_user_since(user: &UserId, since: i32, conn: &DbConn) -> Vec<Self> {
        let user = user.clone();
        conn.run(move |conn| {
            agent_tombstones::table
                .filter(agent_tombstones::user_uuid.eq(user))
                .filter(agent_tombstones::revision.gt(since))
                .load::<Self>(conn)
                .unwrap_or_default()
        })
        .await
    }

    pub async fn delete_all_by_user(user: &UserId, conn: &DbConn) -> EmptyResult {
        let user = user.clone();
        conn.run(move |conn| {
            diesel::delete(agent_tombstones::table.filter(agent_tombstones::user_uuid.eq(user)))
                .execute(conn)
                .map_res("Error deleting tombstones")
        })
        .await
    }
}

impl MigrationMap {
    pub async fn find(
        user: &UserId,
        migration_id: &str,
        kind: &str,
        parent_key: &str,
        local_id: &str,
        conn: &DbConn,
    ) -> Option<Self> {
        let user = user.clone();
        let migration_id = migration_id.to_owned();
        let kind = kind.to_owned();
        let parent_key = parent_key.to_owned();
        let local_id = local_id.to_owned();
        conn.run(move |conn| {
            migration_maps::table
                .filter(migration_maps::user_uuid.eq(user))
                .filter(migration_maps::migration_id.eq(migration_id))
                .filter(migration_maps::resource_kind.eq(kind))
                .filter(migration_maps::parent_key.eq(parent_key))
                .filter(migration_maps::local_resource_id.eq(local_id))
                .first::<Self>(conn)
                .ok()
        })
        .await
    }

    /// Insert only. A concurrent insert loses and the caller reads the winner.
    pub async fn insert_new(&self, conn: &DbConn) -> Result<bool, crate::Error> {
        let row = self.clone();
        conn.run(move |conn| {
            diesel::insert_into(migration_maps::table)
                .values(&row)
                .execute(conn)
                .map(|n| n == 1)
                .or_else(|e| {
                    let msg = e.to_string();
                    if msg.contains("UNIQUE") || msg.contains("Duplicate") || msg.contains("duplicate") {
                        Ok(false)
                    } else {
                        Err(e)
                    }
                })
                .map_res("Error saving migration map")
        })
        .await
    }

    pub async fn mark_gone(&self, conn: &DbConn) -> EmptyResult {
        let row = self.clone();
        conn.run(move |conn| {
            diesel::update(
                migration_maps::table
                    .filter(migration_maps::user_uuid.eq(&row.user_uuid))
                    .filter(migration_maps::migration_id.eq(&row.migration_id))
                    .filter(migration_maps::resource_kind.eq(&row.resource_kind))
                    .filter(migration_maps::parent_key.eq(&row.parent_key))
                    .filter(migration_maps::local_resource_id.eq(&row.local_resource_id)),
            )
            .set(migration_maps::gone.eq(true))
            .execute(conn)
            .map_res("Error marking migration gone")
        })
        .await
    }

    pub async fn set_checksum(&self, checksum: &str, conn: &DbConn) -> EmptyResult {
        let row = self.clone();
        let checksum = checksum.to_owned();
        conn.run(move |conn| {
            diesel::update(
                migration_maps::table
                    .filter(migration_maps::user_uuid.eq(&row.user_uuid))
                    .filter(migration_maps::migration_id.eq(&row.migration_id))
                    .filter(migration_maps::resource_kind.eq(&row.resource_kind))
                    .filter(migration_maps::parent_key.eq(&row.parent_key))
                    .filter(migration_maps::local_resource_id.eq(&row.local_resource_id)),
            )
            .set(migration_maps::bytes_checksum.eq(checksum))
            .execute(conn)
            .map_res("Error saving attachment checksum")
        })
        .await
    }

    pub async fn delete_all_by_user(user: &UserId, conn: &DbConn) -> EmptyResult {
        let user = user.clone();
        conn.run(move |conn| {
            diesel::delete(migration_maps::table.filter(migration_maps::user_uuid.eq(user)))
                .execute(conn)
                .map_res("Error deleting migration maps")
        })
        .await
    }
}

pub fn allocate_agent_revision(conn: &mut crate::db::DbConnInner) -> Result<i32, diesel::result::Error> {
    diesel::update(agent_revision::table.filter(agent_revision::id.eq(1)))
        .set(agent_revision::revision.eq(agent_revision::revision + 1))
        .execute(conn)?;
    agent_revision::table.filter(agent_revision::id.eq(1)).select(agent_revision::revision).first(conn)
}

pub async fn commit_agent_change<T, F>(conn: &DbConn, change: F) -> Result<T, crate::Error>
where
    T: Send + 'static,
    F: FnOnce(&mut crate::db::DbConnInner, i32) -> Result<T, crate::Error> + Send,
{
    conn.run(move |c| {
        c.transaction::<T, crate::Error, _>(|c| {
            let revision = allocate_agent_revision(c)?;
            change(c, revision)
        })
    })
    .await
}

/// Consume both buckets or neither. A new installation id does not reset the shared bucket.
pub async fn consume_guest(
    installation_id: &str,
    per_day: i32,
    shared: i32,
    conn: &DbConn,
) -> Result<(), ConsumeError> {
    let day = Utc::now().format("%Y-%m-%d").to_string();
    let installation = format!("installation:{installation_id}");
    conn.run(move |conn| {
        conn.transaction::<(), ConsumeError, _>(|conn| {
            for (bucket, limit) in [(&installation[..], per_day), ("all-guests", shared)] {
                macro_rules! initialize {
                    ($connection:expr, $target:expr) => {
                        diesel::insert_into(guest_decision_use::table)
                            .values((
                                guest_decision_use::bucket.eq(bucket),
                                guest_decision_use::day.eq(&day),
                                guest_decision_use::count.eq(0),
                            ))
                            .on_conflict($target)
                            .do_nothing()
                            .execute($connection)?
                    };
                }
                match conn {
                    #[cfg(mysql)]
                    crate::db::DbConnInner::Mysql(c) => {
                        initialize!(c, diesel::dsl::DuplicatedKeys);
                    }
                    #[cfg(postgresql)]
                    crate::db::DbConnInner::Postgresql(c) => {
                        initialize!(c, (guest_decision_use::bucket, guest_decision_use::day));
                    }
                    #[cfg(sqlite)]
                    crate::db::DbConnInner::Sqlite(c) => {
                        initialize!(c, (guest_decision_use::bucket, guest_decision_use::day));
                    }
                }
                let changed = diesel::update(
                    guest_decision_use::table
                        .filter(guest_decision_use::bucket.eq(bucket))
                        .filter(guest_decision_use::day.eq(&day))
                        .filter(guest_decision_use::count.lt(limit)),
                )
                .set(guest_decision_use::count.eq(guest_decision_use::count + 1))
                .execute(conn)?;
                if changed != 1 {
                    return Err(ConsumeError::Exhausted);
                }
            }
            Ok(())
        })
    })
    .await
}

#[derive(Debug)]
pub enum ConsumeError {
    Exhausted,
    Store(diesel::result::Error),
}

impl From<diesel::result::Error> for ConsumeError {
    fn from(error: diesel::result::Error) -> Self {
        Self::Store(error)
    }
}

pub async fn remember_installation(installation_id: &str, conn: &DbConn) -> EmptyResult {
    let installation_id = installation_id.to_owned();
    let created_at = now();
    conn.run(move |conn| {
        diesel::insert_into(guest_installations::table)
            .values((
                guest_installations::installation_id.eq(installation_id),
                guest_installations::created_at.eq(created_at),
            ))
            .execute(conn)
            .or_else(|e| match e {
                diesel::result::Error::DatabaseError(diesel::result::DatabaseErrorKind::UniqueViolation, _) => Ok(0),
                error => Err(error),
            })
            .map(|_| ())
            .map_res("Error saving guest installation")
    })
    .await
}

pub async fn delete_user_rows(user: &UserId, conn: &DbConn) -> EmptyResult {
    commit_agent_change(conn, move |c, _| {
        diesel::delete(agent_pairings::table.filter(agent_pairings::user_uuid.eq(user))).execute(c)?;
        diesel::delete(agent_requests::table.filter(agent_requests::user_uuid.eq(user))).execute(c)?;
        diesel::delete(agent_grants::table.filter(agent_grants::user_uuid.eq(user))).execute(c)?;
        diesel::delete(agent_activity::table.filter(agent_activity::user_uuid.eq(user))).execute(c)?;
        diesel::delete(form_bindings::table.filter(form_bindings::user_uuid.eq(user))).execute(c)?;
        diesel::delete(agent_tombstones::table.filter(agent_tombstones::user_uuid.eq(user))).execute(c)?;
        diesel::delete(migration_maps::table.filter(migration_maps::user_uuid.eq(user))).execute(c)?;
        Ok(())
    })
    .await
}

pub async fn current_agent_revision(conn: &DbConn) -> i32 {
    conn.run(|c| {
        agent_revision::table
            .filter(agent_revision::id.eq(1))
            .select(agent_revision::revision)
            .first(c)
            .expect("Error reading agent revision")
    })
    .await
}

impl MigrationMap {
    pub async fn attachment_by_remote(user: &UserId, remote: &str, conn: &DbConn) -> Option<Self> {
        conn.run(move |c| {
            migration_maps::table
                .filter(migration_maps::user_uuid.eq(user))
                .filter(migration_maps::resource_kind.eq("attachment"))
                .filter(migration_maps::remote_id.eq(remote))
                .first::<Self>(c)
                .optional()
        })
        .await
        .expect("Error loading attachment migration")
    }
}

pub async fn delete_cipher_rows(cipher: &CipherId, conn: &DbConn) -> EmptyResult {
    commit_agent_change(conn, move |c, revision| {
        for row in agent_grants::table.filter(agent_grants::source_cipher_uuid.eq(cipher)).load::<AgentGrant>(c)? {
            insert_tombstone(c, row.user_uuid, "grant", row.uuid.to_string(), revision)?;
        }
        for row in form_bindings::table.filter(form_bindings::profile_cipher_uuid.eq(cipher)).load::<FormBinding>(c)? {
            insert_tombstone(c, row.user_uuid, "formBinding", row.uuid.to_string(), revision)?;
        }
        for row in agent_activity::table
            .filter(agent_activity::source_cipher_uuid.eq(cipher.as_ref()))
            .load::<AgentActivity>(c)?
        {
            insert_tombstone(c, row.user_uuid, "activity", row.uuid.to_string(), revision)?;
        }
        diesel::delete(agent_grants::table.filter(agent_grants::source_cipher_uuid.eq(cipher))).execute(c)?;
        diesel::delete(form_bindings::table.filter(form_bindings::profile_cipher_uuid.eq(cipher))).execute(c)?;
        diesel::delete(agent_activity::table.filter(agent_activity::source_cipher_uuid.eq(cipher.as_ref())))
            .execute(c)?;
        diesel::update(
            migration_maps::table
                .filter(migration_maps::resource_kind.eq("cipher"))
                .filter(migration_maps::remote_id.eq(cipher.as_ref())),
        )
        .set(migration_maps::gone.eq(true))
        .execute(c)?;
        diesel::update(
            migration_maps::table
                .filter(migration_maps::resource_kind.eq("attachment"))
                .filter(migration_maps::parent_key.eq(cipher.as_ref())),
        )
        .set(migration_maps::gone.eq(true))
        .execute(c)?;
        Ok(())
    })
    .await
}

pub async fn delete_org_rows(org: &super::OrganizationId, conn: &DbConn) -> EmptyResult {
    commit_agent_change(conn, move |c, revision| {
        for row in
            agent_activity::table.filter(agent_activity::organization_uuid.eq(org.as_ref())).load::<AgentActivity>(c)?
        {
            insert_tombstone(c, row.user_uuid, "activity", row.uuid.to_string(), revision)?;
        }
        diesel::delete(agent_activity::table.filter(agent_activity::organization_uuid.eq(org.as_ref()))).execute(c)?;
        Ok(())
    })
    .await
}

fn insert_tombstone(
    c: &mut crate::db::DbConnInner,
    user: UserId,
    kind: &str,
    row: String,
    revision: i32,
) -> Result<(), diesel::result::Error> {
    diesel::insert_into(agent_tombstones::table)
        .values(&AgentTombstone {
            uuid: crate::util::get_uuid(),
            user_uuid: user,
            kind: kind.into(),
            row_uuid: row,
            revision,
            deleted_at: now(),
        })
        .execute(c)?;
    Ok(())
}
