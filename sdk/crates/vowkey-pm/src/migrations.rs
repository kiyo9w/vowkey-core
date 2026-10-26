//! Manages repository migrations for the Vowkey SDK.

use vowkey_core::client::persisted_state::OrganizationSharedKey;
use vowkey_organizations::ProfileOrganization;
use vowkey_policies::Policy;
use vowkey_send::Send;
use vowkey_state::{
    SettingItem,
    repository::{RepositoryItem, RepositoryMigrationStep, RepositoryMigrations},
};
use vowkey_vault::{Cipher, Folder};

/// Returns a list of all SDK-managed repository migrations.
pub fn get_sdk_managed_migrations() -> RepositoryMigrations {
    use RepositoryMigrationStep::*;
    RepositoryMigrations::new(vec![
        // Add any new migrations here. Note that order matters, and that removing a repository
        // requires a separate migration step using `Remove(...)`.
        Add(Cipher::data()),
        Add(Folder::data()),
        Add(SettingItem::data()),
        Add(OrganizationSharedKey::data()),
        Add(Send::data()),
        Add(Policy::data()),
        Add(ProfileOrganization::data()),
    ])
}

/// Macro to create the client managed repositories for the SDK.
/// To add a new repository, add it to the list in the macro invocation.
/// This is meant to be used by the final application crates (e.g., vowkey-uniffi,
/// vowkey-wasm-internal, vowkey).
#[macro_export]
macro_rules! create_client_managed_repositories {
    ($container_name:ident, $macro:ident) => {
        $macro! {
            $container_name;
            // List any SDK-managed repositories here. The format is:
            // <fully qualified path to the item>, <item type idenfier>, <field name>, <name of the repository implementation>
            ::vowkey_vault::Cipher, Cipher, cipher, CipherRepository;
            ::vowkey_vault::Folder, Folder, folder, FolderRepository;
            ::vowkey_core::key_management::LocalUserDataKeyState, LocalUserDataKeyState, local_user_data_key_state, LocalUserDataKeyStateRepository;
            ::vowkey_core::client::persisted_state::OrganizationSharedKey, OrganizationSharedKey, organization_shared_key, OrganizationSharedKeyRepository;
            ::vowkey_send::Send, Send, send, SendRepository;
            ::vowkey_policies::Policy, Policy, policy, PolicyRepository;
            ::vowkey_organizations::ProfileOrganization, ProfileOrganization, organization, ProfileOrganizationRepository;
        }
    };
}
