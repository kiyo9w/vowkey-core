use thiserror::Error;
use vowkey_error::vowkey_error;

#[allow(missing_docs)]
#[vowkey_error(flat)]
#[derive(Error, Debug)]
pub enum ExportError {
    #[error(transparent)]
    MissingField(#[from] vowkey_core::MissingFieldError),
    #[error(transparent)]
    NotAuthenticated(#[from] vowkey_core::NotAuthenticatedError),

    #[error("CSV error: {0}")]
    Csv(#[from] crate::csv::CsvError),
    #[error("Credential Exchange error: {0}")]
    Cxf(#[from] crate::cxf::CxfError),
    #[error("JSON error: {0}")]
    Json(#[from] crate::json::JsonError),
    #[error("Encrypted JSON error: {0}")]
    EncryptedJson(#[from] crate::encrypted_json::EncryptedJsonError),

    #[error(transparent)]
    VowkeyCrypto(#[from] vowkey_crypto::CryptoError),
    #[error(transparent)]
    Cipher(#[from] vowkey_vault::CipherError),
}
