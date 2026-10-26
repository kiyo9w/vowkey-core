#![doc = include_str!("../README.md")]

/// Dev-only debug-capability tree rooted on the top-level client. Compiled only
/// under the `debug-capabilities` feature.
#[cfg(feature = "debug-capabilities")]
pub mod debug;

use std::sync::Arc;

use vowkey_auth::AuthClientExt as _;
use vowkey_core::{
    ClientBuilder, FromClient,
    auth::{ClientManagedTokenHandler, ClientManagedTokens},
    client::tracing_middleware::ReqwestTracingMiddleware,
};
use vowkey_crypto_cipher_suite::CryptoCipherSuiteClientExt as _;
#[cfg(not(target_arch = "wasm32"))]
use vowkey_crypto_sync_handler::CryptoSyncHandler;
use vowkey_crypto_sync_handler::CryptoSyncHandlerClientExt as _;
use vowkey_emergency_access::EmergencyAccessClientExt as _;
use vowkey_exporters::ExporterClientExt as _;
use vowkey_generators::GeneratorClientsExt as _;
use vowkey_importers::ImporterClientExt as _;
use vowkey_member_administration::OrganizationUsersManagementClientExt as _;
use vowkey_organization_invite_link::InviteLinkClientExt as _;
use vowkey_organizations::OrganizationsClientExt as _;
use vowkey_policies::{PoliciesClientExt as _, PolicySyncHandler};
use vowkey_send::{SendClientExt as _, SendSyncHandler, SendSyncHandlerClientExt as _};
use vowkey_sync::SyncClientExt as _;
use vowkey_unlock::UnlockClientExt as _;
use vowkey_user_crypto_management::UserCryptoManagementClientExt;
use vowkey_vault::{FolderSyncHandler, VaultClientExt as _};

#[cfg(feature = "uniffi")]
uniffi::setup_scaffolding!();

/// Re-export subclients for easier access
pub mod clients {
    pub use vowkey_auth::AuthClient;
    pub use vowkey_collections::collection_client::CollectionsClient;
    pub use vowkey_core::key_management::CryptoClient;
    pub use vowkey_crypto_cipher_suite::CryptoCipherSuiteClient;
    pub use vowkey_crypto_sync_handler::CryptoSyncHandlerClient;
    pub use vowkey_emergency_access::EmergencyAccessClient;
    pub use vowkey_exporters::ExporterClient;
    pub use vowkey_generators::GeneratorClient;
    pub use vowkey_importers::ImporterClient;
    pub use vowkey_member_administration::OrganizationUsersManagementClient;
    pub use vowkey_organization_invite_link::InviteLinkClient;
    pub use vowkey_organizations::OrganizationsClient;
    pub use vowkey_policies::PolicyClient;
    pub use vowkey_send::{SendClient, SendSyncHandlerClient};
    pub use vowkey_sync::SyncClient;
    pub use vowkey_unlock::UnlockClient;
    pub use vowkey_vault::VaultClient;
}

mod builder;
pub mod migrations;
pub use builder::PasswordManagerClientBuilder;
pub use vowkey_core::{RehydrationError, SaveStateData};
pub use vowkey_unlock::{SessionKey, UnlockError, UnlockMethod};

/// The main entry point for the Vowkey Password Manager SDK
#[derive(Clone)]
pub struct PasswordManagerClient(pub vowkey_core::Client);

impl PasswordManagerClient {
    /// Initialize a new instance of the SDK client
    pub fn new(settings: Option<vowkey_core::ClientSettings>) -> Self {
        let mut builder = PasswordManagerClientBuilder::new();
        if let Some(s) = settings {
            builder = builder.with_settings(s);
        }
        builder.build()
    }

    /// Returns a [`PasswordManagerClientBuilder`] for constructing a new [`PasswordManagerClient`].
    pub fn builder() -> PasswordManagerClientBuilder {
        PasswordManagerClientBuilder::new()
    }

    /// Initialize a new instance of the SDK client with client-managed tokens.
    pub fn new_with_client_tokens(
        settings: Option<vowkey_core::ClientSettings>,
        tokens: Arc<dyn ClientManagedTokens>,
    ) -> Self {
        let mut builder = ClientBuilder::new()
            .with_token_handler(ClientManagedTokenHandler::new(tokens))
            .with_middleware(vec![Arc::new(ReqwestTracingMiddleware)]);
        if let Some(s) = settings {
            builder = builder.with_settings(s);
        }
        Self(builder.build())
    }

    /// Initialize a new instance of the SDK client with SDK managed state and sync handlers
    /// registered
    ///
    /// This will eventually replace `new` when the SDK fully owns sync on all clients.
    pub fn new_with_sync(settings: Option<vowkey_core::ClientSettings>) -> Self {
        let client = Self::new(settings);

        let sync = client.sync();
        #[cfg(not(target_arch = "wasm32"))]
        sync.register_sync_handler(Arc::new(CryptoSyncHandler::new(client.0.clone())));
        sync.register_sync_handler(Arc::new(FolderSyncHandler::from_client(&client.0)));
        sync.register_sync_handler(Arc::new(SendSyncHandler::from_client(&client.0)));
        sync.register_sync_handler(Arc::new(PolicySyncHandler::from_client(&client.0)));

        // TODO: Add more sync handlers here!

        client
    }

    /// Platform operations
    pub fn platform(&self) -> vowkey_core::platform::PlatformClient {
        self.0.platform()
    }

    /// Auth operations
    pub fn auth(&self) -> vowkey_auth::AuthClient {
        self.0.auth_new()
    }

    /// Crypto operations
    pub fn crypto(&self) -> vowkey_core::key_management::CryptoClient {
        self.0.crypto()
    }

    /// Crypto cipher suite operations
    pub fn crypto_cipher_suite(&self) -> vowkey_crypto_cipher_suite::CryptoCipherSuiteClient {
        self.0.crypto_cipher_suite()
    }

    /// Feature flag operations
    pub fn flags(&self) -> vowkey_core::FlagsClient {
        self.0.flags()
    }

    /// Key management operations that run on every sync
    pub fn crypto_sync_handler(&self) -> vowkey_crypto_sync_handler::CryptoSyncHandlerClient {
        self.0.crypto_sync_handler()
    }

    /// Operations that manage the cryptographic machinery of a user account, including key-rotation
    pub fn user_crypto_management(
        &self,
    ) -> vowkey_user_crypto_management::UserCryptoManagementClient {
        self.0.user_crypto_management()
    }

    /// Vault item operations
    pub fn vault(&self) -> vowkey_vault::VaultClient {
        self.0.vault()
    }

    /// Collection related operations.
    ///
    /// This is registered directly on the top-level client in addition to being nested under
    /// [`vault`](Self::vault); once all consumers have migrated to this accessor, the nested one
    /// will be removed.
    pub fn collections(&self) -> vowkey_collections::collection_client::CollectionsClient {
        vowkey_collections::collection_client::CollectionsClient::from_client(&self.0)
    }

    /// Exporter operations
    pub fn exporters(&self) -> vowkey_exporters::ExporterClient {
        self.0.exporters()
    }

    /// Importer operations
    pub fn importers(&self) -> vowkey_importers::ImporterClient {
        self.0.importers()
    }

    /// Generator operations
    pub fn generator(&self) -> vowkey_generators::GeneratorClient {
        self.0.generator()
    }

    /// Send operations
    pub fn sends(&self) -> vowkey_send::SendClient {
        self.0.sends()
    }

    /// Send sync handler operations
    pub fn send_sync_handler(&self) -> vowkey_send::SendSyncHandlerClient {
        self.0.send_sync_handler()
    }

    /// Policy operations
    pub fn policies(&self) -> vowkey_policies::PolicyClient {
        self.0.policies()
    }

    /// Operations on the current user's organizations
    pub fn organizations(&self) -> vowkey_organizations::OrganizationsClient {
        self.0.organizations()
    }

    /// Organization invite link operations
    pub fn invite_link(&self) -> vowkey_organization_invite_link::InviteLinkClient {
        self.0.invite_link()
    }

    /// Emergency access operations, performed as the grantee.
    pub fn emergency_access(&self) -> vowkey_emergency_access::EmergencyAccessClient {
        self.0.emergency_access()
    }

    /// Organization member administration operations.
    pub fn organization_users_management(
        &self,
    ) -> vowkey_member_administration::OrganizationUsersManagementClient {
        self.0.organization_users_management()
    }

    /// Sync operations
    pub fn sync(&self) -> vowkey_sync::SyncClient {
        self.0.sync()
    }

    /// Returns true when the user's symmetric key is loaded into the key store.
    pub fn is_unlocked(&self) -> bool {
        use vowkey_core::key_management::SymmetricKeySlotId;
        self.0
            .internal
            .get_key_store()
            .context()
            .has_symmetric_key(SymmetricKeySlotId::User)
    }

    /// Unlock operations
    pub fn unlock(&self) -> vowkey_unlock::UnlockClient {
        self.0.unlock()
    }

    /// Write rehydration state to a StateRegistry.
    ///
    /// Delegates to [`Client::save_to_state`](vowkey_core::Client::save_to_state).
    pub async fn save_to_state(
        data: SaveStateData,
        reg: &vowkey_state::registry::StateRegistry,
    ) -> Result<(), RehydrationError> {
        vowkey_core::Client::save_to_state(data, reg).await
    }

    /// Reconstruct a locked PasswordManagerClient from a populated StateRegistry.
    ///
    /// Delegates to [`Client::load_from_state`](vowkey_core::Client::load_from_state).
    pub async fn load_from_state(
        token_handler: std::sync::Arc<dyn vowkey_core::auth::auth_tokens::TokenHandler>,
        registry: vowkey_state::registry::StateRegistry,
    ) -> Result<Self, RehydrationError> {
        let client = vowkey_core::Client::load_from_state(token_handler, registry).await?;
        Ok(PasswordManagerClient(client))
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use super::*;

    #[test]
    fn new_with_server_communication_config_constructs() {
        struct MockCookieProvider;

        #[async_trait::async_trait]
        impl vowkey_server_communication_config::CookieProvider for MockCookieProvider {
            async fn cookies(&self, _hostname: &str) -> Vec<(String, String)> {
                vec![]
            }

            async fn acquire_cookie(
                &self,
                _hostname: &str,
            ) -> Result<(), vowkey_server_communication_config::AcquireCookieError> {
                Ok(())
            }

            async fn needs_bootstrap(&self, _hostname: &str) -> bool {
                false
            }
        }

        let _client = PasswordManagerClient::builder()
            .with_server_communication_config(Arc::new(MockCookieProvider))
            .build();
    }
}
