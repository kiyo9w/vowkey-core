use serde::{Deserialize, Serialize};
use vowkey_api_api::models::CipherApiKeyModel;
use vowkey_core::key_management::{KeySlotIds, SymmetricKeySlotId};
use vowkey_crypto::{
    CompositeEncryptable, CryptoError, Decryptable, EncString, KeyStoreContext,
    PrimitiveEncryptable,
};

use super::cipher::CipherKind;
use crate::{Cipher, VaultParseError, cipher::cipher::CopyableCipherFields};

/// An API key or token (cipher type 100). Every value is an `EncString` under the cipher key.
/// `allowed_hosts` decrypts to a JSON array of host strings.
#[serde_with::skip_serializing_none]
#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
#[vowkey_ffi::wasm_record]
pub struct ApiKey {
    pub value: Option<EncString>,
    pub send_style: Option<EncString>,
    pub allowed_hosts: Option<EncString>,
    pub header_name: Option<EncString>,
    pub basic_username: Option<EncString>,
}

/// How the proxy attaches a key to a request.
#[allow(missing_docs)]
#[derive(Serialize, Deserialize, Debug, Clone, Default, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
#[vowkey_ffi::wasm_record]
pub struct ApiKeyView {
    pub value: Option<String>,
    /// `bearer`, `header` or `basic`.
    pub send_style: Option<String>,
    pub allowed_hosts: Vec<String>,
    /// Required by the `header` send style.
    pub header_name: Option<String>,
    /// Required by the `basic` send style. The empty string is a value.
    pub basic_username: Option<String>,
}

impl CompositeEncryptable<KeySlotIds, SymmetricKeySlotId, ApiKey> for ApiKeyView {
    fn encrypt_composite(
        &self,
        ctx: &mut KeyStoreContext<KeySlotIds>,
        key: SymmetricKeySlotId,
    ) -> Result<ApiKey, CryptoError> {
        let hosts = serde_json::to_string(&self.allowed_hosts)
            .map_err(|_| CryptoError::MissingField("allowed_hosts"))?;
        Ok(ApiKey {
            value: self.value.encrypt(ctx, key)?,
            send_style: self.send_style.encrypt(ctx, key)?,
            allowed_hosts: Some(hosts.encrypt(ctx, key)?),
            header_name: self.header_name.encrypt(ctx, key)?,
            basic_username: self.basic_username.encrypt(ctx, key)?,
        })
    }
}

impl Decryptable<KeySlotIds, SymmetricKeySlotId, ApiKeyView> for ApiKey {
    fn decrypt(
        &self,
        ctx: &mut KeyStoreContext<KeySlotIds>,
        key: SymmetricKeySlotId,
    ) -> Result<ApiKeyView, CryptoError> {
        let hosts: Option<String> = self.allowed_hosts.decrypt(ctx, key).ok().flatten();
        Ok(ApiKeyView {
            value: self.value.decrypt(ctx, key).ok().flatten(),
            send_style: self.send_style.decrypt(ctx, key).ok().flatten(),
            allowed_hosts: hosts
                .and_then(|h| serde_json::from_str::<Vec<String>>(&h).ok())
                .unwrap_or_default(),
            header_name: self.header_name.decrypt(ctx, key).ok().flatten(),
            basic_username: self.basic_username.decrypt(ctx, key).ok().flatten(),
        })
    }
}

impl CipherKind for ApiKey {
    fn decrypt_subtitle(
        &self,
        ctx: &mut KeyStoreContext<KeySlotIds>,
        key: SymmetricKeySlotId,
    ) -> Result<String, CryptoError> {
        let hosts: Option<String> = self.allowed_hosts.decrypt(ctx, key).ok().flatten();
        Ok(hosts
            .and_then(|h| serde_json::from_str::<Vec<String>>(&h).ok())
            .and_then(|h| h.into_iter().next())
            .unwrap_or_default())
    }

    fn get_copyable_fields(&self, _: Option<&Cipher>) -> Vec<CopyableCipherFields> {
        Vec::new()
    }
}

impl TryFrom<CipherApiKeyModel> for ApiKey {
    type Error = VaultParseError;

    fn try_from(api_key: CipherApiKeyModel) -> Result<Self, Self::Error> {
        Ok(Self {
            value: EncString::try_from_optional(api_key.value)?,
            send_style: EncString::try_from_optional(api_key.send_style)?,
            allowed_hosts: EncString::try_from_optional(api_key.allowed_hosts)?,
            header_name: EncString::try_from_optional(api_key.header_name)?,
            basic_username: EncString::try_from_optional(api_key.basic_username)?,
        })
    }
}

impl From<ApiKey> for CipherApiKeyModel {
    fn from(api_key: ApiKey) -> Self {
        Self {
            value: api_key.value.map(|v| v.to_string()),
            send_style: api_key.send_style.map(|v| v.to_string()),
            allowed_hosts: api_key.allowed_hosts.map(|v| v.to_string()),
            header_name: api_key.header_name.map(|v| v.to_string()),
            basic_username: api_key.basic_username.map(|v| v.to_string()),
        }
    }
}

#[cfg(test)]
mod tests {
    use vowkey_core::key_management::create_test_crypto_with_user_key;
    use vowkey_crypto::{SymmetricCryptoKey, SymmetricKeyAlgorithm};

    use super::*;

    fn bearer_key() -> ApiKeyView {
        ApiKeyView {
            value: Some("sk-test-123".to_string()),
            send_style: Some("bearer".to_string()),
            allowed_hosts: vec![
                "api.openai.com".to_string(),
                "*.openai.com:8443".to_string(),
            ],
            header_name: None,
            basic_username: None,
        }
    }

    #[test]
    fn round_trips_through_encryption() {
        let key = SymmetricCryptoKey::make(SymmetricKeyAlgorithm::Aes256CbcHmac);
        let key_store = create_test_crypto_with_user_key(key);
        let mut ctx = key_store.context();

        let encrypted = bearer_key()
            .encrypt_composite(&mut ctx, SymmetricKeySlotId::User)
            .unwrap();
        assert!(encrypted.header_name.is_none());
        assert!(encrypted.basic_username.is_none());

        let decrypted: ApiKeyView = encrypted
            .decrypt(&mut ctx, SymmetricKeySlotId::User)
            .unwrap();
        assert_eq!(decrypted, bearer_key());
    }

    #[test]
    fn an_empty_basic_username_is_a_value() {
        let key = SymmetricCryptoKey::make(SymmetricKeyAlgorithm::Aes256CbcHmac);
        let key_store = create_test_crypto_with_user_key(key);
        let mut ctx = key_store.context();

        let view = ApiKeyView {
            value: Some("secret".to_string()),
            send_style: Some("basic".to_string()),
            allowed_hosts: vec!["registry.example.com".to_string()],
            header_name: None,
            basic_username: Some(String::new()),
        };
        let encrypted = view
            .encrypt_composite(&mut ctx, SymmetricKeySlotId::User)
            .unwrap();
        assert!(encrypted.basic_username.is_some());

        let decrypted: ApiKeyView = encrypted
            .decrypt(&mut ctx, SymmetricKeySlotId::User)
            .unwrap();
        assert_eq!(decrypted.basic_username.as_deref(), Some(""));
    }

    #[test]
    fn the_wire_object_holds_ciphertext_only() {
        let key = SymmetricCryptoKey::make(SymmetricKeyAlgorithm::Aes256CbcHmac);
        let key_store = create_test_crypto_with_user_key(key);
        let mut ctx = key_store.context();

        let encrypted = bearer_key()
            .encrypt_composite(&mut ctx, SymmetricKeySlotId::User)
            .unwrap();
        let wire: CipherApiKeyModel = encrypted.into();
        let json = serde_json::to_string(&wire).unwrap();
        assert!(!json.contains("sk-test-123"));
        assert!(!json.contains("openai"));
        assert!(!json.contains("bearer"));
        assert!(wire.value.unwrap().starts_with("2."));
    }
}
