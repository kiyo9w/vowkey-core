const { existsSync } = require("fs");
const { join } = require("path");

const { platform, arch } = process;

let nativeBinding = null;
let localFileExisted = false;
let loadError = null;

function loadFirstAvailable(localFiles, nodeModule) {
  for (const localFile of localFiles) {
    if (existsSync(join(__dirname, localFile))) {
      try {
        return require(`./${localFile}`);
      } catch (e) {
        loadError = e;
      }
    }
  }

  try {
    return require(nodeModule);
  } catch (e) {
    if (!loadError) {
      loadError = e;
    }
    return null;
  }
}

function createFallbackBinding() {
  const NOT_SUPPORTED = "Passkey provider is not supported on this platform.";
  const PASSWORD_NOT_FOUND = "Password not found.";

  class AutofillIpcServer {
    static async listen() {
      return new AutofillIpcServer();
    }
    getPaths() {
      return [];
    }
    stop() {}
    completeRegistration() {
      return 0;
    }
    completeAssertion() {
      return 0;
    }
    completeLockStatus() {
      return 0;
    }
    completeWindowHandleQuery() {
      return 0;
    }
    completeError() {
      return 0;
    }
    completeExcludedCredentialMatched() {
      return 0;
    }
    completeCredentialNotFound() {
      return 0;
    }
  }

  class BiometricLockSystem {}

  class NativeIpcServer {
    static async listen() {
      return new NativeIpcServer();
    }
    getPaths() {
      return [];
    }
    stop() {}
    send() {
      return 0;
    }
    sendTo() {}
  }

  class SshAgentState {
    static async serve() {
      return new SshAgentState();
    }
    stop() {}
    isRunning() {
      return false;
    }
    replace() {}
  }

  const biometrics = {
    BiometricLockSystem,
    authenticate: async () => false,
    authenticateAvailable: async () => false,
    enrollPersistent: async () => {},
    hasPersistent: async () => false,
    initBiometricSystem: () => new BiometricLockSystem(),
    provideKey: async () => {},
    unenroll: async () => {},
    unlock: async () => Buffer.alloc(0),
    unlockAvailable: async () => false,
  };

  const autotype_mvp = {
    getForegroundWindowTitle: () => "",
    typeInput: () => {},
  };

  const clipboards = {
    read: async () => "",
    write: async () => {},
  };

  const passwords = {
    PASSWORD_NOT_FOUND,
    deletePassword: async () => {},
    getPassword: async () => {
      throw new Error(PASSWORD_NOT_FOUND);
    },
    isAvailable: async () => false,
    setPassword: async () => {},
  };

  const ipc = {
    IpcMessageType: { Connected: 0, Disconnected: 1, Message: 2 },
    NativeIpcServer,
  };

  const window_info = {
    getForegroundWindowInfo: () => null,
    focusExternalWindow: () => false,
  };

  return {
    autofill: {
      AutofillIpcServer,
      UserVerification: {
        Preferred: "preferred",
        Required: "required",
        Discouraged: "discouraged",
      },
      runCommand: async () => "",
    },
    autostart: {
      setAutostart: async () => {},
    },
    autotype_mvp,
    autotype: autotype_mvp,
    biometrics,
    biometric: biometrics,
    chromium_importer: {
      getAvailableProfiles: async () => [],
      getMetadata: () => ({}),
      importLogins: async () => [],
      requestBrowserAccess: async () => {},
    },
    clipboards,
    clipboard: clipboards,
    ipc,
    logging: {
      LogLevel: { Trace: 0, Debug: 1, Info: 2, Warn: 3, Error: 4 },
      initNapiLog: () => {},
    },
    passkey_authenticator: {
      NOT_SUPPORTED,
      getState: async () => ({ registered: false, enabled: false }),
      register: () => {
        throw new Error(NOT_SUPPORTED);
      },
    },
    passwords,
    powermonitors: {
      isLockMonitorAvailable: async () => false,
      onLock: async () => {},
    },
    processisolations: {
      disableCoredumps: async () => {},
      isCoreDumpingDisabled: async () => false,
      isolateProcess: async () => {},
    },
    sshagent: {
      SIGNamespace: { Git: "git", File: "file", Unsupported: "unsupported" },
      SshAgentState,
    },
    windows_registry: {
      createKey: async () => {},
      deleteKey: async () => {},
    },
    window_info,
    windowInfo: window_info,
    getForegroundWindowInfo: () => null,
    focusExternalWindow: () => false,
    writeConcealedClipboard: () => false,
  };
}

try {
  switch (platform) {
    case "android":
      switch (arch) {
        case "arm64":
          nativeBinding = loadFirstAvailable(
            ["desktop_napi.android-arm64.node"],
            "@vowkey/desktop-napi-android-arm64",
          );
          break;
        case "arm":
          nativeBinding = loadFirstAvailable(
            ["desktop_napi.android-arm.node"],
            "@vowkey/desktop-napi-android-arm",
          );
          break;
        default:
          loadError = new Error(`Unsupported architecture on Android ${arch}`);
      }
      break;
    case "win32":
      switch (arch) {
        case "x64":
          nativeBinding = loadFirstAvailable(
            ["desktop_napi.win32-x64-msvc.node"],
            "@vowkey/desktop-napi-win32-x64-msvc",
          );
          break;
        case "ia32":
          nativeBinding = loadFirstAvailable(
            ["desktop_napi.win32-ia32-msvc.node"],
            "@vowkey/desktop-napi-win32-ia32-msvc",
          );
          break;
        case "arm64":
          nativeBinding = loadFirstAvailable(
            ["desktop_napi.win32-arm64-msvc.node"],
            "@vowkey/desktop-napi-win32-arm64-msvc",
          );
          break;
        default:
          loadError = new Error(`Unsupported architecture on Windows: ${arch}`);
      }
      break;
    case "darwin":
      switch (arch) {
        case "x64":
          nativeBinding = loadFirstAvailable(
            ["desktop_napi.darwin-x64.node"],
            "@vowkey/desktop-napi-darwin-x64",
          );
          break;
        case "arm64":
          nativeBinding = loadFirstAvailable(
            ["desktop_napi.darwin-arm64.node"],
            "@vowkey/desktop-napi-darwin-arm64",
          );
          break;
        default:
          loadError = new Error(`Unsupported architecture on macOS: ${arch}`);
      }
      break;
    case "linux":
      switch (arch) {
        case "x64":
          nativeBinding = loadFirstAvailable(
            ["desktop_napi.linux-x64-gnu.node"],
            "@vowkey/desktop-napi-linux-x64-gnu",
          );
          break;
        case "arm64":
          nativeBinding = loadFirstAvailable(
            ["desktop_napi.linux-arm64-gnu.node"],
            "@vowkey/desktop-napi-linux-arm64-gnu",
          );
          break;
        case "arm":
          nativeBinding = loadFirstAvailable(
            ["desktop_napi.linux-arm-gnu.node"],
            "@vowkey/desktop-napi-linux-arm-gnu",
          );
          if (!nativeBinding) {
            localFileExisted = existsSync(join(__dirname, "desktop_napi.linux-arm-gnueabihf.node"));
            try {
              if (localFileExisted) {
                nativeBinding = require("./desktop_napi.linux-arm-gnueabihf.node");
              } else {
                nativeBinding = require("@vowkey/desktop-napi-linux-arm-gnueabihf");
              }
            } catch (e) {
              loadError = e;
            }
          }
          break;
        default:
          loadError = new Error(`Unsupported architecture on Linux: ${arch}`);
      }
      break;
    default:
      loadError = new Error(`Unsupported OS: ${platform}, architecture: ${arch}`);
  }
} catch (e) {
  loadError = e;
}

if (!nativeBinding) {
  if (process.env.VOWKEY_STRICT_NAPI === "1") {
    if (loadError) {
      throw loadError;
    }
    throw new Error("Failed to load native binding");
  }
  const detail = loadError && loadError.message ? ` (${loadError.message})` : "";
  console.warn(
    `[desktop_napi] Native module unavailable for ${platform}-${arch}${detail}; using JS fallback stubs.`,
  );
  nativeBinding = createFallbackBinding();
}

module.exports = nativeBinding;
