#[macro_use]
extern crate napi_derive;

mod passkey_authenticator_internal;
mod registry;

// NAPI namespaces
// In each of these modules, the types are defined within a nested namespace of
// the same name so that NAPI can export the TypeScript types within a
// namespace.
pub mod autofill;
pub mod autostart;
pub mod autotype_mvp; // MVP, delete with PM-41067
pub mod biometrics;
pub mod chromium_importer;
pub mod clipboards;
pub mod ipc;
pub mod logging;
pub mod passkey_authenticator;
pub mod passwords;
pub mod powermonitors;
pub mod processisolations;
pub mod sshagent;
pub mod window_context;
pub mod windows_registry;

pub use window_context::{
    focus_external_window, get_foreground_window_info, window_info, write_concealed_clipboard,
    ForegroundWindowInfo,
};
