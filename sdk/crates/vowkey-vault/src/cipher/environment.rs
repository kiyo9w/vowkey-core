use serde::{Deserialize, Serialize};
use vowkey_api_api::models::CipherEnvironmentModel;
use vowkey_core::key_management::{KeySlotIds, SymmetricKeySlotId};
use vowkey_crypto::{
    CompositeEncryptable, CryptoError, Decryptable, EncString, KeyStoreContext,
    PrimitiveEncryptable,
};

use super::cipher::CipherKind;
use crate::{Cipher, VaultParseError, cipher::cipher::CopyableCipherFields};

/// An environment (cipher type 101): a synced list of key references. `members` decrypts to a JSON
/// array of `{"name": "OPENAI_API_KEY", "itemId": "<key cipher id>"}`. No resolved value, device
/// path or enable bit is part of the cipher.
#[serde_with::skip_serializing_none]
#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
#[vowkey_ffi::wasm_record]
pub struct Environment {
    pub members: Option<EncString>,
}

/// One variable of an environment and the key item it takes its value from.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
#[vowkey_ffi::wasm_record]
pub struct EnvironmentMember {
    pub name: String,
    pub item_id: String,
}

#[allow(missing_docs)]
#[derive(Serialize, Deserialize, Debug, Clone, Default, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
#[vowkey_ffi::wasm_record]
pub struct EnvironmentView {
    pub members: Vec<EnvironmentMember>,
}

fn decrypt_members(
    members: &Option<EncString>,
    ctx: &mut KeyStoreContext<KeySlotIds>,
    key: SymmetricKeySlotId,
) -> Vec<EnvironmentMember> {
    let json: Option<String> = members.decrypt(ctx, key).ok().flatten();
    json.and_then(|j| serde_json::from_str::<Vec<EnvironmentMember>>(&j).ok())
        .unwrap_or_default()
}

impl CompositeEncryptable<KeySlotIds, SymmetricKeySlotId, Environment> for EnvironmentView {
    fn encrypt_composite(
        &self,
        ctx: &mut KeyStoreContext<KeySlotIds>,
        key: SymmetricKeySlotId,
    ) -> Result<Environment, CryptoError> {
        let members = serde_json::to_string(&self.members)
            .map_err(|_| CryptoError::MissingField("members"))?;
        Ok(Environment {
            members: Some(members.encrypt(ctx, key)?),
        })
    }
}

impl Decryptable<KeySlotIds, SymmetricKeySlotId, EnvironmentView> for Environment {
    fn decrypt(
        &self,
        ctx: &mut KeyStoreContext<KeySlotIds>,
        key: SymmetricKeySlotId,
    ) -> Result<EnvironmentView, CryptoError> {
        Ok(EnvironmentView {
            members: decrypt_members(&self.members, ctx, key),
        })
    }
}

impl CipherKind for Environment {
    fn decrypt_subtitle(
        &self,
        ctx: &mut KeyStoreContext<KeySlotIds>,
        key: SymmetricKeySlotId,
    ) -> Result<String, CryptoError> {
        Ok(decrypt_members(&self.members, ctx, key)
            .into_iter()
            .map(|m| m.name)
            .collect::<Vec<_>>()
            .join(", "))
    }

    fn get_copyable_fields(&self, _: Option<&Cipher>) -> Vec<CopyableCipherFields> {
        Vec::new()
    }
}

impl TryFrom<CipherEnvironmentModel> for Environment {
    type Error = VaultParseError;

    fn try_from(environment: CipherEnvironmentModel) -> Result<Self, Self::Error> {
        Ok(Self {
            members: EncString::try_from_optional(environment.members)?,
        })
    }
}

impl From<Environment> for CipherEnvironmentModel {
    fn from(environment: Environment) -> Self {
        Self {
            members: environment.members.map(|m| m.to_string()),
        }
    }
}

#[cfg(test)]
mod tests {
    use vowkey_core::key_management::create_test_crypto_with_user_key;
    use vowkey_crypto::{SymmetricCryptoKey, SymmetricKeyAlgorithm};

    use super::*;

    #[test]
    fn members_round_trip_and_stay_references() {
        let key = SymmetricCryptoKey::make(SymmetricKeyAlgorithm::Aes256CbcHmac);
        let key_store = create_test_crypto_with_user_key(key);
        let mut ctx = key_store.context();

        let view = EnvironmentView {
            members: vec![
                EnvironmentMember {
                    name: "OPENAI_API_KEY".to_string(),
                    item_id: "7d1c2a40-0e11-4a9c-8d2b-5f6a7b8c9d01".to_string(),
                },
                EnvironmentMember {
                    name: "STRIPE_KEY".to_string(),
                    item_id: "1b2c3d4e-5f60-4718-92a3-b4c5d6e7f809".to_string(),
                },
            ],
        };
        let encrypted = view
            .encrypt_composite(&mut ctx, SymmetricKeySlotId::User)
            .unwrap();
        let wire: CipherEnvironmentModel = encrypted.clone().into();
        let json = serde_json::to_string(&wire).unwrap();
        assert!(!json.contains("OPENAI_API_KEY"));
        assert!(!json.contains("7d1c2a40"));

        let decrypted: EnvironmentView = encrypted
            .decrypt(&mut ctx, SymmetricKeySlotId::User)
            .unwrap();
        assert_eq!(decrypted, view);
    }
}
