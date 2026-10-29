use crate::{
    Error,
    db::{
        DbConn,
        models::*,
        schema::{agent_activity, agent_grants, agent_pairings, agent_requests, form_bindings},
    },
};
use diesel::prelude::*;
use serde_json::Value;
use std::collections::HashSet;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AgentRotation {
    pub id: String,
    pub kind: String,
    pub revision: i32,
    pub encrypted_metadata: Option<String>,
    pub routing: Option<String>,
    pub note: Option<String>,
    pub answer: Option<String>,
    pub result: Option<String>,
    pub encrypted_grant: Option<String>,
    pub encrypted_activity: Option<String>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BindingRotation {
    pub id: String,
    pub revision: i32,
    pub encrypted_binding: String,
}
fn failure() -> Error {
    Error::new_msg("All encrypted agent records and form bindings must be included at their current revision")
        .with_code(409)
}
fn require(value: Option<&str>) -> Result<(), Error> {
    super::agent::ciphertext(value.ok_or_else(failure)?).map_err(|_| failure())
}

struct PrivateRecords {
    pairings: Vec<AgentPairing>,
    requests: Vec<AgentRequest>,
    grants: Vec<AgentGrant>,
    activity: Vec<AgentActivity>,
    bindings: Vec<FormBinding>,
}
async fn private_records(user: &UserId, conn: &DbConn) -> Result<PrivateRecords, Error> {
    conn.run(move |c| {
        Ok(PrivateRecords {
            pairings: agent_pairings::table.filter(agent_pairings::user_uuid.eq(user)).load(c)?,
            requests: agent_requests::table.filter(agent_requests::user_uuid.eq(user)).load(c)?,
            grants: agent_grants::table.filter(agent_grants::user_uuid.eq(user)).load(c)?,
            activity: agent_activity::table
                .filter(agent_activity::user_uuid.eq(user))
                .filter(agent_activity::organization_uuid.is_null())
                .load(c)?,
            bindings: form_bindings::table.filter(form_bindings::user_uuid.eq(user)).load(c)?,
        })
    })
    .await
}

pub async fn export_private(user: &UserId, conn: &DbConn) -> Result<Value, Error> {
    let records = private_records(user, conn).await?;
    let mut rows = Vec::new();
    for row in records.pairings {
        rows.push(
            json!({"id":row.uuid,"kind":"pairing","revision":row.revision,"encryptedMetadata":row.encrypted_metadata}),
        );
    }
    for row in records.requests {
        rows.push(json!({"id":row.uuid,"kind":"request","revision":row.revision,"routing":row.routing,"note":row.note,"answer":row.answer,"result":row.result}));
    }
    for row in records.grants {
        rows.push(json!({"id":row.uuid,"kind":"grant","revision":row.revision,"encryptedGrant":row.encrypted_grant}));
    }
    for row in records.activity {
        rows.push(
            json!({"id":row.uuid,"kind":"activity","revision":row.revision,"encryptedActivity":row.encrypted_activity}),
        );
    }
    let bindings = records
        .bindings
        .into_iter()
        .map(|row| json!({"id":row.uuid,"revision":row.revision,"encryptedBinding":row.encrypted_binding}))
        .collect::<Vec<_>>();
    Ok(json!({"agentRecords":rows,"formBindings":bindings}))
}

pub async fn validate(
    user: &UserId,
    rows: &[AgentRotation],
    bindings: &[BindingRotation],
    conn: &DbConn,
) -> Result<(), Error> {
    validate_records(rows, bindings, private_records(user, conn).await?)
}

fn validate_records(
    rows: &[AgentRotation],
    bindings: &[BindingRotation],
    current: PrivateRecords,
) -> Result<(), Error> {
    let provided = rows.iter().map(|row| (row.kind.as_str(), row.id.as_str())).collect::<HashSet<_>>();
    let binding_ids = bindings.iter().map(|row| row.id.as_str()).collect::<HashSet<_>>();
    if provided.len() != rows.len() || binding_ids.len() != bindings.len() {
        return Err(failure());
    }
    let expected = current.pairings.len() + current.requests.len() + current.grants.len() + current.activity.len();
    if expected != rows.len() || current.bindings.len() != bindings.len() {
        return Err(failure());
    }
    for row in current.pairings {
        let replacement = rows
            .iter()
            .find(|r| r.kind == "pairing" && r.id.as_str() == row.uuid.as_ref().as_str())
            .ok_or_else(failure)?;
        if replacement.revision != row.revision {
            return Err(failure());
        }
        require(replacement.encrypted_metadata.as_deref())?;
    }
    for row in current.requests {
        let replacement = rows
            .iter()
            .find(|r| r.kind == "request" && r.id.as_str() == row.uuid.as_ref().as_str())
            .ok_or_else(failure)?;
        if replacement.revision != row.revision
            || row.note.is_some() != replacement.note.is_some()
            || row.answer.is_some() != replacement.answer.is_some()
            || row.result.is_some() != replacement.result.is_some()
        {
            return Err(failure());
        }
        require(replacement.routing.as_deref())?;
        for value in [&replacement.note, &replacement.answer, &replacement.result].into_iter().flatten() {
            require(Some(value))?;
        }
    }
    for row in current.grants {
        let replacement = rows
            .iter()
            .find(|r| r.kind == "grant" && r.id.as_str() == row.uuid.as_ref().as_str())
            .ok_or_else(failure)?;
        if replacement.revision != row.revision {
            return Err(failure());
        }
        require(replacement.encrypted_grant.as_deref())?;
    }
    for row in current.activity {
        let replacement = rows
            .iter()
            .find(|r| r.kind == "activity" && r.id.as_str() == row.uuid.as_ref().as_str())
            .ok_or_else(failure)?;
        if replacement.revision != row.revision {
            return Err(failure());
        }
        require(replacement.encrypted_activity.as_deref())?;
    }
    for row in current.bindings {
        let replacement = bindings.iter().find(|r| r.id.as_str() == row.uuid.as_ref().as_str()).ok_or_else(failure)?;
        if replacement.revision != row.revision {
            return Err(failure());
        }
        require(Some(&replacement.encrypted_binding))?;
    }
    Ok(())
}

pub async fn rotate(
    user: &UserId,
    rows: Vec<AgentRotation>,
    bindings: Vec<BindingRotation>,
    conn: &DbConn,
) -> Result<(), Error> {
    conn.run(move |c| {
        c.transaction::<(), Error, _>(|c| {
            let revision = allocate_agent_revision(c)?;
            for row in rows {
                let changed = match row.kind.as_str() {
                    "pairing" => diesel::update(
                        agent_pairings::table
                            .filter(agent_pairings::uuid.eq(row.id))
                            .filter(agent_pairings::user_uuid.eq(user))
                            .filter(agent_pairings::revision.eq(row.revision)),
                    )
                    .set((
                        agent_pairings::encrypted_metadata.eq(row.encrypted_metadata.ok_or_else(failure)?),
                        agent_pairings::revision.eq(revision),
                    ))
                    .execute(c)?,
                    "request" => diesel::update(
                        agent_requests::table
                            .filter(agent_requests::uuid.eq(row.id))
                            .filter(agent_requests::user_uuid.eq(user))
                            .filter(agent_requests::revision.eq(row.revision)),
                    )
                    .set((
                        agent_requests::routing.eq(row.routing.ok_or_else(failure)?),
                        agent_requests::note.eq(row.note),
                        agent_requests::answer.eq(row.answer),
                        agent_requests::result.eq(row.result),
                        agent_requests::revision.eq(revision),
                    ))
                    .execute(c)?,
                    "grant" => diesel::update(
                        agent_grants::table
                            .filter(agent_grants::uuid.eq(row.id))
                            .filter(agent_grants::user_uuid.eq(user))
                            .filter(agent_grants::revision.eq(row.revision)),
                    )
                    .set((
                        agent_grants::encrypted_grant.eq(row.encrypted_grant.ok_or_else(failure)?),
                        agent_grants::revision.eq(revision),
                    ))
                    .execute(c)?,
                    "activity" => diesel::update(
                        agent_activity::table
                            .filter(agent_activity::uuid.eq(row.id))
                            .filter(agent_activity::user_uuid.eq(user))
                            .filter(agent_activity::organization_uuid.is_null())
                            .filter(agent_activity::revision.eq(row.revision)),
                    )
                    .set((
                        agent_activity::encrypted_activity.eq(row.encrypted_activity.ok_or_else(failure)?),
                        agent_activity::revision.eq(revision),
                    ))
                    .execute(c)?,
                    _ => return Err(failure()),
                };
                if changed != 1 {
                    return Err(failure());
                }
            }
            for row in bindings {
                let changed = diesel::update(
                    form_bindings::table
                        .filter(form_bindings::uuid.eq(row.id))
                        .filter(form_bindings::user_uuid.eq(user))
                        .filter(form_bindings::revision.eq(row.revision)),
                )
                .set((form_bindings::encrypted_binding.eq(row.encrypted_binding), form_bindings::revision.eq(revision)))
                .execute(c)?;
                if changed != 1 {
                    return Err(failure());
                }
            }
            Ok(())
        })
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    fn encrypted() -> String {
        format!(
            "2.{}|{}|{}",
            data_encoding::BASE64.encode(&[0; 16]),
            data_encoding::BASE64.encode(&[1; 16]),
            data_encoding::BASE64.encode(&[2; 32])
        )
    }
    fn request() -> AgentRequest {
        let mut request = AgentRequest::new(
            "request".to_owned().into(),
            "owner".to_owned().into(),
            "pairing".into(),
            "executor".to_owned().into(),
            "[]".into(),
            encrypted(),
            None,
        );
        request.revision = 7;
        request.answer = Some(encrypted());
        request
    }
    fn replacement(note: Option<String>) -> AgentRotation {
        AgentRotation {
            id: "request".into(),
            kind: "request".into(),
            revision: 7,
            routing: Some(encrypted()),
            note,
            answer: Some(encrypted()),
            result: None,
            encrypted_metadata: None,
            encrypted_grant: None,
            encrypted_activity: None,
        }
    }
    fn current() -> PrivateRecords {
        PrivateRecords {
            pairings: vec![],
            requests: vec![request()],
            grants: vec![],
            activity: vec![],
            bindings: vec![],
        }
    }
    #[test]
    fn rotation_cannot_resurrect_an_answered_note_or_omit_records() {
        assert!(validate_records(&[replacement(None)], &[], current()).is_ok());
        assert!(validate_records(&[replacement(Some(encrypted()))], &[], current()).is_err());
        assert!(validate_records(&[], &[], current()).is_err());
        assert!(validate_records(&[replacement(None), replacement(None)], &[], current()).is_err());
        let mut stale = replacement(None);
        stale.revision = 6;
        assert!(validate_records(&[stale], &[], current()).is_err());
    }
}
