use std::sync::Arc;

use vowkey_core::client::ApiConfigurations;

mod create;
mod delete;
mod download_url;

pub use create::CreateAttachmentAdminError;
pub use delete::DeleteAttachmentAdminError;
pub use download_url::CipherAdminGetAttachmentDownloadUrlError;

/// Wrapper for attachment admin operations. Uses the admin server API endpoints and does
/// not modify local state.
#[vowkey_ffi::wasm_object]
pub struct AttachmentAdminClient {
    pub(crate) api_configurations: Arc<ApiConfigurations>,
}
