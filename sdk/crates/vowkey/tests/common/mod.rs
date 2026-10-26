use std::process::Command;

/// Create a new vowkey CLI command
pub fn vowkey() -> Command {
    Command::new(env!("CARGO_BIN_EXE_vowkey"))
}

/// Get the server base URL
///
/// Uses `VOWKEY_SERVER_URL` environment variable if set,
/// otherwise defaults to "https://localhost:8080"
#[allow(dead_code)]
pub fn server_base() -> String {
    std::env::var("VOWKEY_SERVER_URL").unwrap_or_else(|_| "https://localhost:8080".to_string())
}
