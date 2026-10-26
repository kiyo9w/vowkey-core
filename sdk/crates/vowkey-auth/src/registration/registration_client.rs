//! Client for account registration and cryptography initialization related API methods.
//! It is used both for the initial registration request in the case of password registrations,
//! and for cryptography initialization for a jit provisioned user. After a method
//! on this client is called, the user account should have initialized account keys, an
//! authentication method such as SSO or master password, and a decryption method such as
//! key-connector, TDE, or master password.

use thiserror::Error;
use vowkey_core::Client;
use vowkey_error::vowkey_error;

/// Client for initializing a user account.
#[derive(Clone)]
#[vowkey_ffi::wasm_object]
pub struct RegistrationClient {
    #[allow(dead_code)]
    pub(crate) client: Client,
}

impl RegistrationClient {
    pub(crate) fn new(client: Client) -> Self {
        Self { client }
    }
}

/// Errors that can occur during user registration.
#[derive(Debug, Error)]
#[vowkey_error(flat)]
pub enum RegistrationError {
    /// Key Connector API call failed.
    #[error("Key Connector Api call failed")]
    KeyConnectorApi,
    /// API call failed.
    #[error("Api call failed")]
    Api,
    /// Cryptography initialization failed.
    #[error("Cryptography initialization failed")]
    Crypto,
    /// Caller-provided input failed validation (e.g. malformed UUID).
    #[error("Invalid input: {0}")]
    InvalidInput(String),
}
