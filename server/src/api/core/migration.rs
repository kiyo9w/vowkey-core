use crate::{
    Error, crypto,
    db::{
        DbConn,
        models::{Attachment, Cipher, MigrationMap, UserId},
        schema::{attachments, ciphers, migration_maps},
    },
};
use chrono::Utc;
use diesel::prelude::*;
use serde_json::Value;

pub struct MigrationInput {
    pub migration_id: String,
    pub local_resource_id: String,
    pub request_hash: String,
}
impl MigrationInput {
    pub fn take(body: &mut Value) -> Result<Option<Self>, Error> {
        let object = body.as_object_mut().ok_or_else(invalid)?;
        let values = [object.remove("migrationId"), object.remove("localResourceId"), object.remove("requestHash")];
        if values.iter().all(Option::is_none) {
            return Ok(None);
        }
        let [
            Some(Value::String(migration_id)),
            Some(Value::String(local_resource_id)),
            Some(Value::String(request_hash)),
        ] = values
        else {
            return Err(invalid());
        };
        if uuid::Uuid::parse_str(&migration_id).is_err()
            || uuid::Uuid::parse_str(&local_resource_id).is_err()
            || !is_checksum(&request_hash)
        {
            return Err(invalid());
        }
        let canonical = serde_json_canonicalizer::to_vec(body).map_err(|_| invalid())?;
        if !crypto::ct_eq(crypto::sha256_hex(&canonical), &request_hash) {
            return Err(invalid());
        }
        Ok(Some(Self {
            migration_id,
            local_resource_id,
            request_hash,
        }))
    }
    pub async fn existing(
        &self,
        user: &UserId,
        kind: &str,
        parent: &str,
        conn: &DbConn,
    ) -> Result<Option<MigrationMap>, Error> {
        let row = MigrationMap::find(user, &self.migration_id, kind, parent, &self.local_resource_id, conn).await;
        if let Some(row) = &row {
            if row.request_hash != self.request_hash {
                return Err(Error::new_msg("migration_hash_mismatch").with_code(409));
            }
            if row.gone {
                return Err(Error::new_msg("migration_resource_gone").with_code(410));
            }
        }
        Ok(row)
    }
    fn row(&self, user: &UserId, kind: &str, parent: &str, remote: &str, checksum: Option<String>) -> MigrationMap {
        MigrationMap {
            user_uuid: user.clone(),
            migration_id: self.migration_id.clone(),
            resource_kind: kind.into(),
            parent_key: parent.into(),
            local_resource_id: self.local_resource_id.clone(),
            remote_id: remote.into(),
            request_hash: self.request_hash.clone(),
            bytes_checksum: checksum,
            gone: false,
            created_at: Utc::now().naive_utc(),
        }
    }
    pub async fn create_cipher(&self, cipher: &Cipher, conn: &DbConn) -> Result<(), Error> {
        let row = self.row(cipher.user_uuid.as_ref().ok_or_else(invalid)?, "cipher", "", cipher.uuid.as_ref(), None);
        conn.run(move |c| {
            c.transaction::<(), Error, _>(|c| {
                diesel::insert_into(ciphers::table).values(cipher).execute(c)?;
                diesel::insert_into(migration_maps::table).values(&row).execute(c)?;
                Ok(())
            })
        })
        .await
    }
    pub async fn create_attachment(
        &self,
        user: &UserId,
        attachment: &Attachment,
        checksum: String,
        conn: &DbConn,
    ) -> Result<(), Error> {
        let row = self.row(user, "attachment", attachment.cipher_uuid.as_ref(), attachment.id.as_ref(), Some(checksum));
        conn.run(move |c| {
            c.transaction::<(), Error, _>(|c| {
                diesel::insert_into(attachments::table).values(attachment).execute(c)?;
                diesel::insert_into(migration_maps::table).values(&row).execute(c)?;
                Ok(())
            })
        })
        .await
    }
}
pub fn is_checksum(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
fn invalid() -> Error {
    Error::new_msg("Invalid migration request").with_code(422)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn jcs_hash_excludes_only_migration_identity_and_uses_ecmascript_numbers() {
        let canonical = r#"{"a":1,"z":1e+30,"😀":"a","":"b"}"#;
        let hash = crypto::sha256_hex(canonical.as_bytes());
        let mut body = json!({"z":1e30,"a":1.0,"\u{e000}":"b","😀":"a","migrationId":"7c1a0e4e-3c2b-4f4a-9d1e-6b8a2f0c1d44","localResourceId":"91d46b1e-0c2a-4e7a-8f33-2c5d7a0b1e44","requestHash":hash});
        assert!(MigrationInput::take(&mut body).unwrap().is_some());
        body["migrationId"] = json!("7c1a0e4e-3c2b-4f4a-9d1e-6b8a2f0c1d44");
        assert!(MigrationInput::take(&mut body).is_err());
    }
}
