[![Github Workflow build on main](https://github.com/bitwarden/clients/actions/workflows/build-cli.yml/badge.svg?branch=main)](https://github.com/bitwarden/clients/actions/workflows/build-cli.yml?query=branch:main)

# Vowkey Command-line Interface

[![Platforms](https://imgur.com/AnTLX0S.png "Platforms")](https://help.vowkey.com/article/cli/#download--install)

The Vowkey CLI is a powerful, full-featured command-line interface (CLI) tool to access and manage a Vowkey vault. The CLI is written with TypeScript and Node.js and can be run on Windows, macOS, and Linux distributions.

## Developer Documentation

Please refer to the [CLI section](https://contributing.vowkey.com/getting-started/clients/cli/) of the [Contributing Documentation](https://contributing.vowkey.com/) for build instructions, recommended tooling, code style tips, and lots of other great information to get you started.

## User Documentation

### Download/Install

You can install the Vowkey CLI multiple different ways:

**NPM**

If you already have the Node.js runtime installed on your system, you can install the CLI using NPM. NPM makes it easy to keep your installation updated and should be the preferred installation method if you are already using Node.js.

```bash
npm install -g @vowkey/cli
```

**Native Executable**

We provide natively packaged versions of the CLI for each platform which have no requirements on installing the Node.js runtime. You can obtain these from the [downloads section](https://help.vowkey.com/article/cli/#download--install) in the documentation.

**Other Package Managers**

- [Chocolatey](https://chocolatey.org/packages/vowkey-cli)
  ```powershell
  choco install vowkey-cli
  ```
- [Homebrew](https://formulae.brew.sh/formula/vowkey-cli)
  ```bash
  brew install vowkey-cli
  ```
  > ⚠️ The homebrew version is not recommended for all users.
  >
  > Homebrew pulls the CLI's GPL build and does not include device approval commands for Enterprise SSO customers.
- [Snap](https://snapcraft.io/vowkey)
  ```bash
  sudo snap install vowkey
  ```

### Help Command

The Vowkey CLI is self-documented with `--help` content and examples for every command. You should start exploring the CLI by using the global `--help` option:

```bash
vowkey --help
```

This option will list all available commands that you can use with the CLI.

Additionally, you can run the `--help` option on a specific command to learn more about it:

```bash
vowkey list --help
vowkey create --help
```

### Unlock with desktop biometrics

When `vowkey unlock` is run interactively without a password, the CLI first attempts to unlock through
the Vowkey desktop app. This requires Vowkey Desktop 2026.9.0 or newer to be running, with
biometric unlock enabled for the same account. If desktop biometric unlock is unavailable or is
cancelled, the CLI falls back to the master password prompt.

Passing a password, `--passwordenv`, or `--passwordfile` skips the biometric attempt. Biometric
unlock is also skipped when `VOWKEY_NOINTERACTION=true`.

The feature is gated behind the `biometrics-sdk-ipc` feature flag, which also gates the desktop
side of the same IPC. While the flag is off the CLI never starts a desktop proxy.

If the desktop app is installed in a non-standard location, set
`VOWKEY_DESKTOP_PROXY_PATH` to the path of its `desktop_proxy` executable.

### Help Center

We provide detailed documentation and examples for using the CLI in our help center at https://help.vowkey.com/article/cli/.
