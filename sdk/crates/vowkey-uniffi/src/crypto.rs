use std::str::FromStr;

use vowkey_core::key_management::{
    V2UpgradeToken,
    crypto::{
        DeriveKeyConnectorRequest, DerivePinKeyResponse, EnrollPinResponse, InitOrgCryptoRequest,
        InitUserCryptoRequest, ReinitUserCryptoRequest, UpdateKdfResponse, UpdatePasswordResponse,
    },
};
use vowkey_crypto::{
    EncString, Kdf, KeyDecryptable, KeyEncryptable,
    RotateableKeySet, UnsignedSharedKey,
};
use vowkey_encoding::B64;

use crate::error::Result;

#[allow(missing_docs)]
#[derive(uniffi::Object)]
pub struct CryptoClient(pub(crate) vowkey_core::key_management::CryptoClient);

#[uniffi::export(async_runtime = "tokio")]
impl CryptoClient {
    /// Initialization method for the user crypto. Needs to be called before any other crypto
    /// operations.
    pub async fn initialize_user_crypto(&self, req: InitUserCryptoRequest) -> Result<()> {
        Ok(self.0.initialize_user_crypto(req).await?)
    }

    /// Initialization method for the organization crypto. Needs to be called after
    /// `initialize_user_crypto` but before any other crypto operations.
    pub async fn initialize_org_crypto(&self, req: InitOrgCryptoRequest) -> Result<()> {
        Ok(self.0.initialize_org_crypto(req).await?)
    }

    /// Re-initialize the user's cryptographic state during an unlock session for handling a synced
    /// v2 upgrade token. Requires the SDK to be unlocked. See
    /// [`vowkey_core::key_management::CryptoClient::reinit_user_crypto`].
    pub async fn reinit_user_crypto(&self, req: ReinitUserCryptoRequest) -> Result<()> {
        Ok(self.0.reinit_user_crypto(req).await?)
    }

    /// Get the uses's decrypted encryption key. Note: It's very important
    /// to keep this key safe, as it can be used to decrypt all of the user's data
    pub async fn get_user_encryption_key(&self) -> Result<B64> {
        Ok(self.0.get_user_encryption_key().await?)
    }

    /// Create the data necessary to update the user's password. The user's encryption key is
    /// re-encrypted with the new password. This returns the new encrypted user key and the new
    /// password hash but does not update sdk state.
    pub async fn make_update_password(
        &self,
        new_password: String,
    ) -> Result<UpdatePasswordResponse> {
        Ok(self.0.make_update_password(new_password).await?)
    }

    /// Generates a PIN protected user key from the provided PIN. The result can be stored and later
    /// used to initialize another client instance by using the PIN and the PIN key with
    /// `initialize_user_crypto`.
    pub async fn derive_pin_key(&self, pin: String) -> Result<DerivePinKeyResponse> {
        Ok(self.0.derive_pin_key(pin).await?)
    }

    /// Derives the pin protected user key from encrypted pin. Used when pin requires master
    /// password on first unlock.
    pub async fn derive_pin_user_key(&self, encrypted_pin: EncString) -> Result<EncString> {
        Ok(self.0.derive_pin_user_key(encrypted_pin).await?)
    }

    /// Protects the current user key with the provided PIN. The result can be stored and later
    /// used to initialize another client instance by using the PIN and the PIN key with
    /// `initialize_user_crypto`.
    pub fn enroll_pin(&self, pin: String) -> Result<EnrollPinResponse> {
        Ok(self.0.enroll_pin(pin)?)
    }

    /// Protects the current user key with the provided PIN. The result can be stored and later
    /// used to initialize another client instance by using the PIN and the PIN key with
    /// `initialize_user_crypto`. The provided pin is encrypted with the user key.
    pub fn enroll_pin_with_encrypted_pin(
        &self,
        encrypted_pin: EncString,
    ) -> Result<EnrollPinResponse> {
        Ok(self
            .0
            .enroll_pin_with_encrypted_pin(encrypted_pin.to_string())?)
    }

    pub fn enroll_admin_password_reset(&self, public_key: B64) -> Result<UnsignedSharedKey> {
        Ok(self.0.enroll_admin_password_reset(public_key)?)
    }

    /// Derive the master key for migrating to the key connector
    pub fn derive_key_connector(&self, request: DeriveKeyConnectorRequest) -> Result<B64> {
        Ok(self.0.derive_key_connector(request)?)
    }

    /// Creates the a new rotateable key set for the current user key protected
    /// by a key derived from the given PRF.
    pub fn make_prf_user_key_set(&self, prf: B64) -> Result<RotateableKeySet> {
        Ok(self.0.make_prf_user_key_set(prf)?)
    }

    /// Create the data necessary to update the user's kdf settings. The user's encryption key is
    /// re-encrypted for the password under the new kdf settings. This returns the new encrypted
    /// user key and the new password hash but does not update sdk state.
    /// Note: This is deprecated. Please use the user-crypto-management client instead.
    pub async fn make_update_kdf(&self, password: String, kdf: Kdf) -> Result<UpdateKdfResponse> {
        #[allow(deprecated)]
        Ok(self.0.make_update_kdf(password, kdf).await?)
    }

    /// Gets the upgraded V2 user key using an upgrade token.
    /// If the current key is already V2, returns it directly.
    /// If the current key is V1 and a token is provided, extracts the V2 key.
    pub fn get_upgraded_user_key(&self, upgrade_token: Option<V2UpgradeToken>) -> Result<B64> {
        Ok(self.0.get_upgraded_user_key(upgrade_token)?)
    }

    /// Takes a base64-encoded raw key and returns the corresponding hex-encoded key id.
    ///
    /// Mirrors the associated function on [`vowkey_core::key_management::CryptoClient`],
    /// because UniFFI does not generate static functions.
    pub fn get_key_id_for_symmetric_key(&self, key: B64) -> Result<Option<String>> {
        let key_id = vowkey_core::key_management::CryptoClient::get_key_id_for_symmetric_key(
            key.into_bytes(),
        )?;
        Ok(key_id.map(|id| id.iter().map(|byte| format!("{byte:02x}")).collect()))
    }

    /// Encrypts a string with explicit key bytes. The result is an EncString.
    pub fn symmetric_encrypt_string(&self, plain: String, key: Vec<u8>) -> Result<String> {
        let key = vowkey_crypto::SymmetricCryptoKey::try_from(
            &vowkey_crypto::VowkeyLegacyKeyBytes::from(key),
        )?;
        Ok(plain.encrypt_with_key(&key)?.to_string())
    }

    /// Decrypts an EncString with explicit key bytes.
    pub fn symmetric_decrypt_string(&self, encrypted: String, key: Vec<u8>) -> Result<String> {
        let key = vowkey_crypto::SymmetricCryptoKey::try_from(
            &vowkey_crypto::VowkeyLegacyKeyBytes::from(key),
        )?;
        Ok(EncString::from_str(&encrypted)?.decrypt_with_key(&key)?)
    }

    /// Unwraps a cipher key from its user-key EncString and returns the raw key bytes.
    pub fn unwrap_symmetric_key(&self, wrapped: String, wrapping_key: Vec<u8>) -> Result<Vec<u8>> {
        use vowkey_core::key_management::KeySlotIds;
        use vowkey_crypto::{KeyStore, VowkeyLegacyKeyBytes};
        let store = KeyStore::<KeySlotIds>::default();
        let mut context = store.context();
        let wrapping = context.add_local_symmetric_key(vowkey_crypto::SymmetricCryptoKey::try_from(
            &VowkeyLegacyKeyBytes::from(wrapping_key),
        )?);
        let unwrapped = context.unwrap_symmetric_key(
            wrapping,
            &vowkey_crypto::EncString::from_str(&wrapped)?,
        )?;
        #[allow(deprecated)]
        let key = context.dangerous_get_symmetric_key(unwrapped)?;
        Ok(key.to_encoded().to_vec())
    }
}
