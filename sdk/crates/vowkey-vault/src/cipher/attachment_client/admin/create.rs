use thiserror::Error;
use vowkey_core::{ApiError, MissingFieldError};
use vowkey_error::vowkey_error;

use super::super::create::{CreateAttachmentFailure, create_attachment};
use crate::{
    AttachmentAdminClient, CipherId, CreateAttachmentRequest, CreatedAttachment, VaultParseError,
    cipher::cipher::PartialCipher,
};

#[allow(missing_docs)]
#[vowkey_error(flat)]
#[derive(Debug, Error)]
pub enum CreateAttachmentAdminError {
    #[error(transparent)]
    Api(#[from] ApiError),
    #[error(transparent)]
    MissingField(#[from] MissingFieldError),
    #[error(transparent)]
    VaultParse(#[from] VaultParseError),
    #[error("Server returned an unsupported file upload type")]
    UnsupportedFileUploadType,
}

impl CreateAttachmentFailure for CreateAttachmentAdminError {
    fn unsupported_file_upload_type() -> Self {
        Self::UnsupportedFileUploadType
    }
}

#[vowkey_ffi::wasm_export]
impl AttachmentAdminClient {
    /// Creates a new attachment slot on the server using the admin endpoint.
    /// Affects server data only, does not modify local state.
    ///
    /// The caller must upload the encrypted bytes to [`CreatedAttachment::upload_url`]
    /// using the transport in [`CreatedAttachment::file_upload_type`].
    ///
    /// If a later step fails after slot creation, the SDK best-effort deletes the
    /// orphaned slot via the admin endpoint and returns the original error.
    pub async fn create_attachment(
        &self,
        cipher_id: CipherId,
        request: CreateAttachmentRequest,
    ) -> Result<CreatedAttachment, CreateAttachmentAdminError> {
        create_attachment(
            &self.api_configurations.api_client,
            cipher_id,
            request,
            true,
            async |response| {
                let cipher_mini = response
                    .cipher_mini_response
                    .ok_or(MissingFieldError("cipher_mini_response"))?;
                Ok((*cipher_mini).merge_with_cipher(None)?)
            },
        )
        .await
    }
}
