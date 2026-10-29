//! Functionality for rotating user keys, bundled with a password change.
use serde::{Deserialize, Serialize};
use tracing::info;
use vowkey_api_api::models::RotateUserAccountKeysAndDataRequestModel;
use vowkey_core::key_management::{
    KeySlotIds, MasterPasswordAuthenticationData,
    account_cryptographic_state::WrappedAccountCryptographicState,
};
use vowkey_crypto::{KeyStore, PublicKey, SymmetricCryptoKey};

use crate::{
    UserCryptoManagementClient,
    key_rotation::{
        RotateUserKeysError,
        crypto::rotate_account_cryptographic_state_to_request_model,
        data::{check_for_old_attachments, reencrypt_data},
        rotate_user_keys::UpgradeTokenAction,
        rotation_context::make_rotation_context,
        sync::{SyncedAccountData, sync_current_account_data},
        unlock::{
            ReencryptCommonUnlockDataInput, ReencryptMasterPasswordChangeAndUnlockInput,
            reencrypt_master_password_change_unlock_data,
        },
    },
};

#[derive(Serialize, Deserialize, Clone)]
#[vowkey_ffi::wasm_record]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct PasswordChangeAndRotateUserKeysRequest {
    pub old_password: String,
    pub password: String,
    pub hint: Option<String>,
    pub trusted_emergency_access_public_keys: Vec<PublicKey>,
    pub trusted_organization_public_keys: Vec<PublicKey>,
}

pub(super) enum PreparedRotationRequest {
    Password(RotateUserAccountKeysAndDataRequestModel),
    Keys {
        request: vowkey_api_api::models::RotateUserKeysRequestModel,
        state: super::rotate_user_keys::StateUpdate,
    },
}

pub(super) struct PreparedRotationData {
    pub current_user_key: SymmetricCryptoKey,
    pub new_user_key: SymmetricCryptoKey,
    pub request: PreparedRotationRequest,
}

/// A prepared rotation stays in SDK memory until its owner stages local recovery and posts it.
#[vowkey_ffi::wasm_object]
pub struct PreparedUserKeyRotation {
    pub(super) client: vowkey_core::Client,
    pub(super) data: PreparedRotationData,
}

#[vowkey_ffi::wasm_export]
impl PreparedUserKeyRotation {
    /// The caller wipes this copy after staging local recovery.
    pub fn current_user_key(&self) -> Vec<u8> {
        self.data.current_user_key.to_encoded().to_vec()
    }

    /// The caller wipes this copy after staging local recovery.
    pub fn new_user_key(&self) -> Vec<u8> {
        self.data.new_user_key.to_encoded().to_vec()
    }

    /// Consumes the prepared request using the account client that prepared it.
    pub async fn post(self) -> Result<(), RotateUserKeysError> {
        post_prepared_rotation(
            &self.client.internal.get_api_configurations().api_client,
            &self.client.km_state_bridge(),
            self.data,
        ).await
    }
}

#[vowkey_ffi::wasm_export]
impl UserCryptoManagementClient {
    /// Combines a password change and user key rotation into a single request.
    pub async fn password_change_and_rotate_user_keys(
        &self,
        request: PasswordChangeAndRotateUserKeysRequest,
    ) -> Result<(), RotateUserKeysError> {
        let prepared = self.prepare_password_change_and_rotate_user_keys(request).await?;
        prepared.post().await
    }

    /// Returns both user keys after the request is built and before the POST.
    pub async fn prepare_password_change_and_rotate_user_keys(
        &self,
        request: PasswordChangeAndRotateUserKeysRequest,
    ) -> Result<PreparedUserKeyRotation, RotateUserKeysError> {
        let api_client = &self.client.internal.get_api_configurations().api_client;
        let key_store = self.client.internal.get_key_store();
        let sync = sync_current_account_data(api_client).await.map_err(|_| RotateUserKeysError::Api)?;
        let wrapped = self
            .regenerate_public_key_encryption_key_pair_if_needed_with_ciphers(&sync.ciphers)
            .await
            .map_err(|_| RotateUserKeysError::Crypto)?
            .unwrap_or_else(|| sync.wrapped_account_cryptographic_state.clone());
        let data = prepare_password_change(key_store, request, wrapped, sync).await?;
        Ok(PreparedUserKeyRotation { client: self.client.clone(), data })
    }

}

pub(super) async fn post_prepared_rotation(
    api_client: &vowkey_api_api::apis::ApiClient,
    state_bridge: &vowkey_core::key_management::state_bridge::StateBridgeClient,
    prepared: PreparedRotationData,
) -> Result<(), RotateUserKeysError> {
    match prepared.request {
        PreparedRotationRequest::Password(request) => {
            api_client.accounts_key_management_api()
                .password_change_and_rotate_user_account_keys(Some(request))
                .await.map_err(|error| match error {
                    vowkey_api_api::apis::Error::Response(response)
                        if matches!(response.status.as_u16(), 400 | 401 | 403 | 404 | 409 | 422) => RotateUserKeysError::Rejected,
                    _ => RotateUserKeysError::Api,
                })?;
        }
        PreparedRotationRequest::Keys { request, state } => {
            api_client.accounts_key_management_api()
                .rotate_user_keys(Some(request))
                .await.map_err(|error| match error {
                    vowkey_api_api::apis::Error::Response(response)
                        if matches!(response.status.as_u16(), 400 | 401 | 403 | 404 | 409 | 422) => RotateUserKeysError::Rejected,
                    _ => RotateUserKeysError::Api,
                })?;
            if let Some(upgrade_token) = state.upgrade_token.as_ref() {
                state_bridge.set_account_cryptographic_state(&state.account_cryptographic_state).await;
                state_bridge.set_v2_upgrade_token(upgrade_token).await;
                state_bridge.set_user_key(&state.user_key).await;
            }
        }
    }
    Ok(())
}

#[vowkey_logging::instrument(name = "password_change_and_rotate_user_keys", level = "info", err)]
async fn prepare_password_change(
    key_store: &KeyStore<KeySlotIds>,
    request: PasswordChangeAndRotateUserKeysRequest,
    wrapped_account_cryptographic_state: WrappedAccountCryptographicState,
    sync: SyncedAccountData,
) -> Result<PreparedRotationData, RotateUserKeysError> {
    check_for_old_attachments(&sync.ciphers)?;
    let (post_request, current_key, new_key) = {
        let mut ctx = key_store.context_mut();
        let rotation_context = make_rotation_context(
            &sync,
            request.trusted_organization_public_keys.as_slice(),
            request.trusted_emergency_access_public_keys.as_slice(),
            UpgradeTokenAction::Skip,
            &mut ctx,
        )?;
        info!("Rotating account cryptographic state for user key rotation");
        let account_keys_model = rotate_account_cryptographic_state_to_request_model(
            &wrapped_account_cryptographic_state,
            &rotation_context.current_user_key_id,
            &rotation_context.new_user_key_id,
            &mut ctx,
        )
        .map_err(|_| RotateUserKeysError::Crypto)?;
        info!("Re-encrypting account data for user key rotation");
        let account_data_model = reencrypt_data(
            sync.folders.as_slice(),
            sync.ciphers.as_slice(),
            sync.sends.as_slice(),
            &sync.agent_data,
            rotation_context.current_user_key_id,
            rotation_context.new_user_key_id,
            &mut ctx,
        )
        .map_err(|_| RotateUserKeysError::Crypto)?;
        info!("Re-encrypting account unlock data for user key rotation");
        let (kdf, salt) = sync.kdf_and_salt.ok_or(RotateUserKeysError::Api)?;
        let unlock_data_model = reencrypt_master_password_change_unlock_data(
            ReencryptMasterPasswordChangeAndUnlockInput {
                password: request.password,
                hint: request.hint,
                kdf: kdf.clone(),
                salt: salt.clone(),
                common_unlock_data: ReencryptCommonUnlockDataInput {
                    trusted_devices: sync.trusted_devices,
                    webauthn_credentials: sync.passkeys,
                    trusted_organization_keys: rotation_context.v1_organization_memberships,
                    trusted_emergency_access_keys: rotation_context.v1_emergency_access_memberships,
                },
            },
            rotation_context.current_user_key_id,
            rotation_context.new_user_key_id,
            &mut ctx,
        )
        .map_err(|_| RotateUserKeysError::Crypto)?;
        let old_master_password_authentication_data =
            MasterPasswordAuthenticationData::derive(&request.old_password, &kdf, &salt)
                .map_err(|_| RotateUserKeysError::Crypto)?;
        (
            RotateUserAccountKeysAndDataRequestModel {
                old_master_key_authentication_hash: Some(
                    old_master_password_authentication_data
                        .master_password_authentication_hash
                        .to_string(),
                ),
                account_keys: Box::new(account_keys_model),
                account_data: Box::new(account_data_model),
                account_unlock_data: Box::new(unlock_data_model),
                new_user_key_id: ctx
                    .get_symmetric_key_id(rotation_context.new_user_key_id)
                    .map(|id| id.to_string()),
            },
            ctx.dangerous_get_symmetric_key(rotation_context.current_user_key_id)
                .map_err(|_| RotateUserKeysError::Crypto)?.to_owned(),
            ctx.dangerous_get_symmetric_key(rotation_context.new_user_key_id)
                .map_err(|_| RotateUserKeysError::Crypto)?.to_owned(),
        )
    };
    Ok(PreparedRotationData {
        current_user_key: current_key,
        new_user_key: new_key,
        request: PreparedRotationRequest::Password(post_request),
    })
}

#[cfg(test)]
mod tests {
    use std::str::FromStr;

    use chrono::DateTime;
    use vowkey_api_api::apis::ApiClient;
    use vowkey_core::key_management::{
        KeySlotIds, SymmetricKeySlotId,
        account_cryptographic_state::WrappedAccountCryptographicState,
    };
    use vowkey_crypto::{Kdf, KeyStore, PublicKeyEncryptionAlgorithm, SymmetricKeyAlgorithm};
    use vowkey_vault::{Attachment, Cipher, CipherType};

    use super::*;

    fn make_state_bridge() -> vowkey_core::key_management::state_bridge::StateBridgeClient {
        let client = vowkey_core::Client::new(None);
        let bridge = client.km_state_bridge();
        bridge.register_bridge(Box::new(
            vowkey_core::key_management::state_bridge::test_support::InMemoryStateBridge::default(),
        ));
        bridge
    }

    fn make_test_key_store_and_synced_data() -> (KeyStore<KeySlotIds>, SyncedAccountData) {
        let store: KeyStore<KeySlotIds> = KeyStore::default();
        let wrapped_private_key = {
            let mut ctx = store.context_mut();
            let user_key = ctx.make_symmetric_key(SymmetricKeyAlgorithm::Aes256CbcHmac);
            let _ = ctx.persist_symmetric_key(user_key, SymmetricKeySlotId::User);
            let private_key = ctx.make_private_key(PublicKeyEncryptionAlgorithm::RsaOaepSha1);
            ctx.wrap_private_key(SymmetricKeySlotId::User, private_key)
                .unwrap()
        };

        let sync = SyncedAccountData {
            wrapped_account_cryptographic_state: WrappedAccountCryptographicState::V1 {
                private_key: wrapped_private_key,
            },
            folders: vec![],
            ciphers: vec![],
            sends: vec![],
            agent_data: Default::default(),
            emergency_access_memberships: vec![],
            organization_memberships: vec![],
            trusted_devices: vec![],
            passkeys: vec![],
            kdf_and_salt: Some((
                Kdf::PBKDF2 {
                    iterations: std::num::NonZeroU32::new(600000).unwrap(),
                },
                "test_salt".to_string(),
            )),
        };

        (store, sync)
    }

    #[tokio::test]
    async fn test_password_change_and_rotate_user_keys_missing_kdf_returns_api_error() {
        let (key_store, mut sync) = make_test_key_store_and_synced_data();
        sync.kdf_and_salt = None;

        let api_client = ApiClient::new_mocked(|mock| {
            mock.accounts_key_management_api
                .expect_password_change_and_rotate_user_account_keys()
                .never();
        });

        let result = prepare_password_change(
            &key_store,
            PasswordChangeAndRotateUserKeysRequest {
                old_password: "old_password".to_string(),
                password: "new_password".to_string(),
                hint: None,
                trusted_organization_public_keys: vec![],
                trusted_emergency_access_public_keys: vec![],
            },
            sync.wrapped_account_cryptographic_state.clone(),
            sync,
        )
        .await;

        assert!(matches!(result, Err(RotateUserKeysError::Api)));
        if let ApiClient::Mock(mut mock) = api_client {
            mock.accounts_key_management_api.checkpoint();
        }
    }

    #[tokio::test]
    async fn test_password_change_and_rotate_user_keys_success() {
        let (key_store, sync) = make_test_key_store_and_synced_data();
        let api_client = ApiClient::new_mocked(|mock| {
            mock.accounts_key_management_api
                .expect_password_change_and_rotate_user_account_keys()
                .once()
                .returning(|_| Ok(()));
        });

        let prepared = prepare_password_change(
            &key_store,
            PasswordChangeAndRotateUserKeysRequest {
                old_password: "old_password".to_string(),
                password: "new_password".to_string(),
                hint: None,
                trusted_organization_public_keys: vec![],
                trusted_emergency_access_public_keys: vec![],
            },
            sync.wrapped_account_cryptographic_state.clone(),
            sync,
        ).await.unwrap();
        let state_bridge = make_state_bridge();
        let result = post_prepared_rotation(&api_client, &state_bridge, prepared).await;

        assert!(result.is_ok());
        if let ApiClient::Mock(mut mock) = api_client {
            mock.accounts_key_management_api.checkpoint();
        }
    }

    #[tokio::test]
    async fn test_password_change_and_rotate_user_keys_post_api_failure_returns_api_error() {
        let (key_store, sync) = make_test_key_store_and_synced_data();
        let api_client = ApiClient::new_mocked(|mock| {
            mock.accounts_key_management_api
                .expect_password_change_and_rotate_user_account_keys()
                .once()
                .returning(|_| {
                    Err(serde_json::Error::io(std::io::Error::other("API error")).into())
                });
        });

        let prepared = prepare_password_change(
            &key_store,
            PasswordChangeAndRotateUserKeysRequest {
                old_password: "old_password".to_string(),
                password: "new_password".to_string(),
                hint: None,
                trusted_organization_public_keys: vec![],
                trusted_emergency_access_public_keys: vec![],
            },
            sync.wrapped_account_cryptographic_state.clone(),
            sync,
        ).await.unwrap();
        let state_bridge = make_state_bridge();
        let result = post_prepared_rotation(&api_client, &state_bridge, prepared).await;

        assert!(matches!(result, Err(RotateUserKeysError::Api)));
        if let ApiClient::Mock(mut mock) = api_client {
            mock.accounts_key_management_api.checkpoint();
        }
    }

    #[tokio::test]
    async fn test_password_change_and_rotate_old_attachments_returns_error() {
        let (key_store, mut sync) = make_test_key_store_and_synced_data();
        let enc_string = "2.STIyTrfDZN/JXNDN9zNEMw==|NDLum8BHZpPNYhJo9ggSkg==|UCsCLlBO3QzdPwvMAWs2VVwuE6xwOx/vxOooPObqnEw=";

        // Add a cipher with an old attachment (key is None)
        sync.ciphers = vec![Cipher {
            partial_data: None,
            id: None,
            organization_id: None,
            folder_id: None,
            collection_ids: vec![],
            r#type: CipherType::Login,
            login: None,
            identity: None,
            card: None,
            secure_note: None,
            ssh_key: None,
            bank_account: None,
            drivers_license: None,
            passport: None,
            api_key: None,
            environment: None,
            favorite: false,
            reprompt: Default::default(),
            organization_use_totp: false,
            edit: false,
            permissions: None,
            view_password: false,
            name: Some(enc_string.parse().unwrap()),
            revision_date: DateTime::from_str("2024-01-01T00:00:00Z").unwrap(),
            archived_date: None,
            creation_date: DateTime::from_str("2024-01-01T00:00:00Z").unwrap(),
            attachments: Some(vec![Attachment {
                id: None,
                url: None,
                size: None,
                size_name: None,
                file_name: None,
                key: None, // Old attachment - no per-attachment key
            }]),
            fields: None,
            key: None,
            notes: None,
            local_data: None,
            password_history: None,
            deleted_date: None,
            data: None,
        }];

        let api_client = ApiClient::new_mocked(|mock| {
            // Rotation API should never be called
            mock.accounts_key_management_api
                .expect_password_change_and_rotate_user_account_keys()
                .never();
        });

        let result = prepare_password_change(
            &key_store,
            PasswordChangeAndRotateUserKeysRequest {
                old_password: "old_password".to_string(),
                password: "new_password".to_string(),
                hint: None,
                trusted_organization_public_keys: vec![],
                trusted_emergency_access_public_keys: vec![],
            },
            sync.wrapped_account_cryptographic_state.clone(),
            sync,
        )
        .await;

        assert!(matches!(result, Err(RotateUserKeysError::OldAttachments)));
        if let ApiClient::Mock(mut mock) = api_client {
            mock.accounts_key_management_api.checkpoint();
        }
    }
}
