#![doc = include_str!("../README.md")]

#[cfg(feature = "uniffi")]
uniffi::setup_scaffolding!();
#[cfg(feature = "uniffi")]
mod uniffi_support;

pub mod auth;
pub mod client;
mod error;
pub mod global;
pub mod key_management;
pub use error::{
    ApiError, MissingFieldError, MissingPrivateKeyError, NotAuthenticatedError, WrongPasswordError,
};
#[cfg(feature = "internal")]
pub mod mobile;
#[cfg(feature = "internal")]
pub mod platform;
#[cfg(feature = "secrets")]
pub mod secrets_manager;

pub use client::{
    Client, ClientBuilder, ClientName, ClientSettings, DeviceType, FromClient, HostPlatformInfo,
    get_host_platform_info, init_host_platform_info,
};
#[cfg(feature = "internal")]
pub use client::{FetchFlagsError, FlagsClient, RehydrationError, SaveStateData};
pub use global::GlobalClient;
/// Derive macro for implementing the [`FromClient`] trait.
///
/// See [`FromClient`] for usage details.
pub use vowkey_core_macro::FromClient;
pub use vowkey_crypto::ZeroizingAllocator;

mod ids;
pub use ids::*;
