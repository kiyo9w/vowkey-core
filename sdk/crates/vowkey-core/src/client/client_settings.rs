use std::{fmt, sync::OnceLock};

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

/// Basic client behavior settings. These settings specify the various targets and behavior of the
/// Vowkey Client. They are optional and uneditable once the client is initialized.
///
/// Defaults to
///
/// ```
/// # use vowkey_core::{ClientSettings, DeviceType};
/// let settings = ClientSettings {
///     identity_url: "https://identity.vowkey.com".to_string(),
///     api_url: "https://api.vowkey.com".to_string(),
///     user_agent: "Vowkey Rust-SDK".to_string(),
///     device_type: DeviceType::SDK,
///     vowkey_client_version: None,
///     vowkey_package_type: None,
///     device_identifier: None,
/// };
/// let default = ClientSettings::default();
/// ```
#[derive(Serialize, Deserialize, Debug, JsonSchema, Clone)]
#[serde(default, rename_all = "camelCase", deny_unknown_fields)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
#[vowkey_ffi::wasm_record]
pub struct ClientSettings {
    /// The identity url of the targeted Vowkey instance. Defaults to `https://identity.vowkey.com`
    pub identity_url: String,
    /// The api url of the targeted Vowkey instance. Defaults to `https://api.vowkey.com`
    pub api_url: String,
    /// The user_agent to sent to Vowkey. Defaults to `Vowkey Rust-SDK`
    pub user_agent: String,
    /// Device type to send to Vowkey. Defaults to SDK
    pub device_type: DeviceType,

    // TODO: PM-29939 - Remove optionality when all clients pass these values
    /// Device identifier to send to Vowkey. Optional for now in transition period.
    pub device_identifier: Option<String>,
    /// Vowkey Client Version to send to Vowkey. Optional for now in transition period.
    pub vowkey_client_version: Option<String>,
    /// Vowkey Package Type to send to Vowkey. We should evaluate this field to see if it
    /// should be optional later.
    pub vowkey_package_type: Option<String>,
}

impl Default for ClientSettings {
    fn default() -> Self {
        Self {
            identity_url: "https://identity.vowkey.com".into(),
            api_url: "https://api.vowkey.com".into(),
            user_agent: "Vowkey Rust-SDK".into(),
            device_type: DeviceType::SDK,
            device_identifier: None,
            vowkey_client_version: None,
            vowkey_package_type: None,
        }
    }
}

#[allow(non_camel_case_types, missing_docs)]
#[derive(Serialize, Deserialize, Copy, Clone, Debug, JsonSchema, PartialEq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
#[vowkey_ffi::wasm_record]
pub enum DeviceType {
    Android = 0,
    iOS = 1,
    ChromeExtension = 2,
    FirefoxExtension = 3,
    OperaExtension = 4,
    EdgeExtension = 5,
    WindowsDesktop = 6,
    MacOsDesktop = 7,
    LinuxDesktop = 8,
    ChromeBrowser = 9,
    FirefoxBrowser = 10,
    OperaBrowser = 11,
    EdgeBrowser = 12,
    IEBrowser = 13,
    UnknownBrowser = 14,
    AndroidAmazon = 15,
    UWP = 16,
    SafariBrowser = 17,
    VivaldiBrowser = 18,
    VivaldiExtension = 19,
    SafariExtension = 20,
    SDK = 21,
    Server = 22,
    WindowsCLI = 23,
    MacOsCLI = 24,
    LinuxCLI = 25,
    DuckDuckGoBrowser = 26,
}

#[derive(Copy, Clone, Debug)]
pub enum ClientName {
    Web,
    Browser,
    Desktop,
    Mobile,
    Cli,
}

impl From<DeviceType> for Option<ClientName> {
    fn from(device_type: DeviceType) -> Self {
        match device_type {
            DeviceType::Android | DeviceType::AndroidAmazon | DeviceType::iOS => {
                Some(ClientName::Mobile)
            }

            DeviceType::ChromeBrowser
            | DeviceType::FirefoxBrowser
            | DeviceType::OperaBrowser
            | DeviceType::EdgeBrowser
            | DeviceType::IEBrowser
            | DeviceType::SafariBrowser
            | DeviceType::VivaldiBrowser
            | DeviceType::DuckDuckGoBrowser
            | DeviceType::UnknownBrowser => Some(ClientName::Web),

            DeviceType::ChromeExtension
            | DeviceType::FirefoxExtension
            | DeviceType::OperaExtension
            | DeviceType::EdgeExtension
            | DeviceType::VivaldiExtension
            | DeviceType::SafariExtension => Some(ClientName::Browser),

            DeviceType::LinuxDesktop
            | DeviceType::MacOsDesktop
            | DeviceType::WindowsDesktop
            | DeviceType::UWP => Some(ClientName::Desktop),

            DeviceType::WindowsCLI | DeviceType::MacOsCLI | DeviceType::LinuxCLI => {
                Some(ClientName::Cli)
            }

            DeviceType::SDK | DeviceType::Server => None,
        }
    }
}

impl fmt::Display for ClientName {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let s = match self {
            ClientName::Web => "web",
            ClientName::Browser => "browser",
            ClientName::Desktop => "desktop",
            ClientName::Mobile => "mobile",
            ClientName::Cli => "cli",
        };
        write!(f, "{}", s)
    }
}

/// Process-wide, application-provided platform information.
///
/// Initialize exactly once at application startup via [`init_host_platform_info`];
/// read via [`get_host_platform_info`]. Subsequent `init` calls are ignored.
#[derive(Debug, Clone)]
pub struct HostPlatformInfo {
    pub user_agent: String,
    pub device_type: DeviceType,
    pub device_identifier: Option<String>,
    pub vowkey_client_version: Option<String>,
    pub vowkey_package_type: Option<String>,
}

impl From<&ClientSettings> for HostPlatformInfo {
    fn from(settings: &ClientSettings) -> Self {
        Self {
            user_agent: settings.user_agent.clone(),
            device_type: settings.device_type,
            device_identifier: settings.device_identifier.clone(),
            vowkey_client_version: settings.vowkey_client_version.clone(),
            vowkey_package_type: settings.vowkey_package_type.clone(),
        }
    }
}

static HOST_PLATFORM_INFO: OnceLock<HostPlatformInfo> = OnceLock::new();

/// Initialize the global [`HostPlatformInfo`].
///
/// Should be called once during application startup, before any
/// `Client::load_from_state` calls. Subsequent calls are silently ignored.
pub fn init_host_platform_info(info: HostPlatformInfo) {
    let _ = HOST_PLATFORM_INFO.set(info);
}

/// Returns the globally-initialized [`HostPlatformInfo`].
///
/// # Panics
/// Panics if [`init_host_platform_info`] has not yet been called.
pub fn get_host_platform_info() -> &'static HostPlatformInfo {
    HOST_PLATFORM_INFO
        .get()
        .expect("host platform info to be initialized")
}

impl HostPlatformInfo {
    /// Derive a [`ClientSettings`] from this platform info, for use in client initialization.
    pub fn to_client_settings(&self, api_url: String, identity_url: String) -> ClientSettings {
        ClientSettings {
            user_agent: self.user_agent.clone(),
            device_type: self.device_type,
            device_identifier: self.device_identifier.clone(),
            vowkey_client_version: self.vowkey_client_version.clone(),
            vowkey_package_type: self.vowkey_package_type.clone(),
            api_url,
            identity_url,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // `OnceLock` is process-global. Any test in this binary that calls
    // `init_host_platform_info` may have run first, so we cannot assert what
    // value won the first-init race — only that a *subsequent* init does not
    // change the stored value.
    #[test]
    fn second_init_does_not_overwrite_first() {
        let first = HostPlatformInfo {
            user_agent: "first".into(),
            device_type: DeviceType::SDK,
            device_identifier: Some("dev-1".into()),
            vowkey_client_version: Some("1.0.0".into()),
            vowkey_package_type: Some("test".into()),
        };
        init_host_platform_info(first);

        // Capture whatever value won the first-init race (ours or another
        // test's).
        let after_first_init = get_host_platform_info().clone();

        let second = HostPlatformInfo {
            user_agent: "second".into(),
            device_type: DeviceType::SDK,
            device_identifier: Some("dev-2".into()),
            vowkey_client_version: Some("2.0.0".into()),
            vowkey_package_type: Some("test".into()),
        };
        init_host_platform_info(second);

        let after_second_init = get_host_platform_info();
        assert_eq!(after_second_init.user_agent, after_first_init.user_agent);
        assert_eq!(after_second_init.device_type, after_first_init.device_type);
        assert_eq!(
            after_second_init.device_identifier,
            after_first_init.device_identifier
        );
        assert_eq!(
            after_second_init.vowkey_client_version,
            after_first_init.vowkey_client_version
        );
        assert_eq!(
            after_second_init.vowkey_package_type,
            after_first_init.vowkey_package_type
        );
    }
}
