use thiserror::Error;
use vowkey_error::vowkey_error;

#[allow(missing_docs)]
#[vowkey_error(flat)]
#[derive(Debug, Error)]
pub enum CollectionDecryptError {
    #[error(transparent)]
    Crypto(#[from] vowkey_crypto::CryptoError),
}

/// Generic error type for collection encryption errors.
///
/// This intentionally mirrors `vowkey_vault::EncryptError` rather than depending on it, to
/// avoid creating a circular dependency between the `vowkey-collections` and `vowkey-vault`
/// crates.
#[allow(missing_docs)]
#[vowkey_error(flat)]
#[derive(Debug, Error)]
pub enum CollectionEncryptError {
    #[error(transparent)]
    Crypto(#[from] vowkey_crypto::CryptoError),
}

#[allow(missing_docs)]
#[derive(Debug, Error)]
pub enum CollectionsParseError {
    #[error(transparent)]
    Crypto(#[from] vowkey_crypto::CryptoError),
    #[error(transparent)]
    MissingField(#[from] vowkey_core::MissingFieldError),
}
