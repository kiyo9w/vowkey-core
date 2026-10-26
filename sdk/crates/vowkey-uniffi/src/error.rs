use vowkey_exporters::ExportError;
use vowkey_generators::{PassphraseError, PasswordError, PasswordRulesError, UsernameError};

pub type Result<T, E = VowkeyError> = std::result::Result<T, E>;
pub type Error = VowkeyError;

/// The single error type the UniFFI surface returns.
///
/// Every exported function in this crate must return it, through the crate's `Result<T>` alias.
/// See [`vowkey_uniffi_error`] for why.
// Name is converted from *Error to *Exception, so we can't just name the enum Error because
// Exception already exists
#[derive(uniffi::Error, thiserror::Error, Debug)]
pub enum VowkeyError {
    #[error(transparent)]
    Api(#[from] vowkey_core::ApiError),
    #[error(transparent)]
    DeriveKeyConnector(#[from] vowkey_core::key_management::crypto::DeriveKeyConnectorError),
    #[error(transparent)]
    EncryptionSettings(#[from] vowkey_core::client::encryption_settings::EncryptionSettingsError),
    #[error(transparent)]
    EnrollAdminPasswordReset(
        #[from] vowkey_core::key_management::crypto::EnrollAdminPasswordResetError,
    ),
    #[error(transparent)]
    MobileCrypto(#[from] vowkey_core::key_management::crypto::CryptoClientError),
    #[error(transparent)]
    ReinitUserCrypto(#[from] vowkey_core::key_management::crypto::ReinitUserCryptoError),
    #[error(transparent)]
    AuthValidate(#[from] vowkey_core::auth::AuthValidateError),
    #[error(transparent)]
    ApproveAuthRequest(#[from] vowkey_core::auth::ApproveAuthRequestError),
    #[error(transparent)]
    TrustDevice(#[from] vowkey_core::auth::auth_client::TrustDeviceError),
    #[error(transparent)]
    Registration(#[from] vowkey_auth::registration::RegistrationError),
    #[error(transparent)]
    PasswordPrelogin(#[from] vowkey_auth::login::login_via_password::PasswordPreloginError),
    #[error(transparent)]
    PasswordLogin(#[from] vowkey_auth::login::login_via_password::PasswordLoginError),

    #[error(transparent)]
    Fingerprint(#[from] vowkey_core::platform::FingerprintError),
    #[error(transparent)]
    UserFingerprint(#[from] vowkey_core::platform::UserFingerprintError),

    #[error(transparent)]
    Crypto(#[from] vowkey_crypto::CryptoError),

    #[error(transparent)]
    StateRegistry(#[from] vowkey_state::registry::StateRegistryError),

    // Generators
    #[error(transparent)]
    Username(#[from] UsernameError),
    #[error(transparent)]
    Passphrase(#[from] PassphraseError),
    #[error(transparent)]
    Password(#[from] PasswordError),
    #[error(transparent)]
    PasswordRules(#[from] PasswordRulesError),

    // Vault
    #[error(transparent)]
    Cipher(#[from] vowkey_vault::CipherError),
    #[error(transparent)]
    Totp(#[from] vowkey_vault::TotpError),
    #[error(transparent)]
    Decrypt(#[from] vowkey_vault::DecryptError),
    #[error(transparent)]
    DecryptFile(#[from] vowkey_vault::DecryptFileError),
    #[error(transparent)]
    Encrypt(#[from] vowkey_vault::EncryptError),
    #[error(transparent)]
    EncryptFile(#[from] vowkey_vault::EncryptFileError),
    #[error(transparent)]
    CreateCipher(#[from] vowkey_vault::CreateCipherError),
    #[error(transparent)]
    EditCipher(#[from] vowkey_vault::EditCipherError),
    #[error(transparent)]
    DeleteCipher(#[from] vowkey_vault::DeleteCipherError),
    #[error(transparent)]
    GetCipher(#[from] vowkey_vault::GetCipherError),
    #[error(transparent)]
    RestoreCipher(#[from] vowkey_vault::RestoreCipherError),
    #[error(transparent)]
    MoveCipher(#[from] vowkey_vault::MoveCipherError),
    #[error(transparent)]
    BulkUpdateCollectionsCipher(#[from] vowkey_vault::BulkUpdateCollectionsCipherError),
    #[error(transparent)]
    CreateFolder(#[from] vowkey_vault::CreateFolderError),
    #[error(transparent)]
    EditFolder(#[from] vowkey_vault::EditFolderError),
    #[error(transparent)]
    GetFolder(#[from] vowkey_vault::GetFolderError),
    #[error(transparent)]
    CreateAttachment(#[from] vowkey_vault::CipherCreateAttachmentError),
    #[error(transparent)]
    DeleteAttachment(#[from] vowkey_vault::CipherDeleteAttachmentError),
    #[error(transparent)]
    RenewFileUploadUrl(#[from] vowkey_vault::CipherRenewFileUploadUrlError),
    #[error(transparent)]
    UpgradeAttachment(#[from] vowkey_vault::CipherUpgradeAttachmentError),
    #[error(transparent)]
    GetAttachmentDownloadUrl(#[from] vowkey_vault::CipherGetAttachmentDownloadUrlError),

    // Collections
    #[error(transparent)]
    CollectionDecrypt(#[from] vowkey_collections::error::CollectionDecryptError),
    #[error(transparent)]
    CollectionEncrypt(#[from] vowkey_collections::error::CollectionEncryptError),

    // Send
    #[error(transparent)]
    SendDecrypt(#[from] vowkey_send::SendDecryptError),
    #[error(transparent)]
    SendDecryptFile(#[from] vowkey_send::SendDecryptFileError),
    #[error(transparent)]
    SendEncrypt(#[from] vowkey_send::SendEncryptError),
    #[error(transparent)]
    SendEncryptFile(#[from] vowkey_send::SendEncryptFileError),

    #[error(transparent)]
    Export(#[from] ExportError),
    #[error(transparent)]
    Import(#[from] vowkey_importers::ImportError),

    // Fido
    #[error(transparent)]
    MakeCredential(#[from] vowkey_fido::MakeCredentialError),
    #[error(transparent)]
    GetAssertion(#[from] vowkey_fido::GetAssertionError),
    #[error(transparent)]
    SilentlyDiscoverCredentials(#[from] vowkey_fido::SilentlyDiscoverCredentialsError),
    #[error(transparent)]
    CredentialsForAutofill(#[from] vowkey_fido::CredentialsForAutofillError),
    #[error(transparent)]
    GetFido2AutofillCredentials(#[from] vowkey_fido::GetFido2AutofillCredentialsError),
    #[error(transparent)]
    Fido2Client(#[from] vowkey_fido::Fido2ClientError),
    #[error(transparent)]
    DeviceAuthKey(#[from] vowkey_fido::DeviceAuthKeyError),

    #[error(transparent)]
    SshGeneration(#[from] vowkey_ssh::error::KeyGenerationError),
    #[error(transparent)]
    SshImport(#[from] vowkey_ssh::error::SshKeyImportError),

    #[error(transparent)]
    AcquireCookie(#[from] vowkey_server_communication_config::AcquireCookieError),

    #[error("Callback invocation failed")]
    Callback,

    #[error("A conversion error occurred: {0}")]
    Conversion(String),
}
/// Required From implementation for UNIFFI callback error handling
/// Converts unexpected mobile exceptions into VowkeyError
impl From<uniffi::UnexpectedUniFFICallbackError> for VowkeyError {
    fn from(_: uniffi::UnexpectedUniFFICallbackError) -> Self {
        Self::Callback
    }
}
