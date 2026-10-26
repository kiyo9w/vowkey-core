use thiserror::Error;
use vowkey_error::vowkey_error;

#[allow(missing_docs)]
#[vowkey_error(flat)]
#[derive(Error, Debug)]
pub enum ImportError {
    #[error("The file is not a valid KeePass database (.kdbx)")]
    KdbxInvalidFormat,
    #[error("The KeePass database exceeds the maximum supported size")]
    KdbxFileTooLarge,
    #[error("Incorrect KeePass password or key file")]
    KdbxWrongCredentials,
    #[error("The KeePass database could not be read; it may be corrupted or unsupported")]
    KdbxCorruptOrUnsupported,

    #[error("The 1Password email address is not valid")]
    OnePasswordInvalidEmail,
    #[error("The 1Password sign-in address is not valid")]
    OnePasswordInvalidSignInAddress,
    #[error("The 1Password Secret Key is not valid")]
    OnePasswordInvalidSecretKey,
    #[error("Incorrect 1Password email, password, or Secret Key")]
    OnePasswordBadCredentials,
    #[error("The 1Password account requires a two-factor code")]
    OnePasswordTwoFactorRequired,
    #[error("The 1Password two-factor code was rejected or not entered")]
    OnePasswordTwoFactorFailed,
    #[error("The 1Password sign-in was canceled")]
    OnePasswordCanceled,
    #[error("The new 1Password device was denied on another device")]
    OnePasswordDenied,
    #[error("This 1Password account uses a sign-in method the importer does not support: {0}")]
    OnePasswordUnsupported(String),
    #[error("Could not reach 1Password: {0}")]
    OnePasswordNetwork(String),
    #[error("The data 1Password returned could not be read")]
    OnePasswordDecryption,

    #[error(transparent)]
    NotAuthenticated(#[from] vowkey_core::NotAuthenticatedError),
    #[error(transparent)]
    Api(#[from] vowkey_core::ApiError),
    #[error(transparent)]
    VowkeyCrypto(#[from] vowkey_crypto::CryptoError),
    /// A Keeper importer cryptography operation failed.
    #[error(transparent)]
    KeeperCrypto(#[from] crate::keeper::crypto::KeeperCryptoError),
    /// Encryption from the shared import bridge (`vowkey_exporters::encrypt_import`).
    #[error(transparent)]
    Export(#[from] vowkey_exporters::ExportError),
}
