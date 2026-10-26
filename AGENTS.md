# Vowkey core: instructions for every agent

This repository is Vowkey's implementation. The product direction lives in `~/Documents/Projects/vowkey`: read its `AGENTS.md`, `NOW.md`, `docs/product-spec.md` and `prompts/build-rust-core.md` before changing anything here. Those standing decisions apply in this repository too: the full scope ships, Bitwarden is the base, a behavior Bitwarden lacks is copied from the product that already does it, and a safeguard is added only when 1Password, Bitwarden, Proton, Chrome or Infisical show the same thing.

## Layout

| Directory | What it is | Upstream it forked |
| --- | --- | --- |
| `sdk/` | The Rust core: crypto, vault, sync, state, auth, send, passkeys, generators, importers, exporters, UniFFI and WebAssembly bindings, and the `vowkey` CLI | `bitwarden/sdk-internal` |
| `server/` | The sync server, `vowkey-server` | `dani-garcia/vaultwarden` |
| `clients/` | The web app, browser extension, desktop app and the Node command line (`apps/cli`), with the shared `libs/` | `bitwarden/clients` |
| `ios/` | The iPhone and iPad app with its autofill, share and watch extensions | `bitwarden/ios` |
| `android/` | The Android app with its autofill service | `bitwarden/android` |
| `mcp/` | The MCP server, which drives the `vowkey` CLI | `bitwarden/mcp-server` |
| `brand/` | Vowkey's icon and marks, the source for every app icon and logo | Vowkey |

Each directory builds on its own (`cargo` in `sdk/` and `server/`, `npm` in `clients/` and `mcp/`, Xcode in `ios/`, Gradle in `android/`), keeps its own lockfile, and is checked by `scripts/check.sh`. The web app, extension and desktop app reach the core through the WebAssembly package built from `sdk/crates/vowkey-wasm-internal`; the phone apps reach it through the UniFFI bindings built from `sdk/crates/vowkey-uniffi`.

## Names

Crates, packages, binaries, apps and user-visible words say Vowkey.

- Rust crates: `vowkey-*`. npm scope: `@vowkey`. Phone app id: `com.vowkey.app`. CLI binary: `vowkey`, with `VOWKEY_*` environment variables (`VOWKEY_SESSION`, `VOWKEY_PASSWORD`). Server binary: `vowkey-server`.
- Apps use the icon and marks in `brand/`.
- The words people see follow `~/Documents/Projects/vowkey/LANGUAGE.md`: Bitwarden's Identity item is a profile on screen, a Secure note is a note, and a vault holds logins, cards, profiles and keys.
- Cloud hostnames that upstream pointed at Bitwarden's cloud now point at `vowkey.com` hosts (`vault.`, `api.`, `identity.`, `send.`). Each is a default in one place per component and is replaced when the real hosts exist.
- `scripts/rename-brand.py` applies these names to a freshly copied upstream tree. Use it for every tree that joins the repository so all of them follow one convention.

## What stays as Bitwarden wrote it

Vowkey syncs on Bitwarden's encryption and sync format. The following are part of that format, or are fixtures derived from it, and keep their upstream spelling. The list is `PROTECT` in `scripts/rename-brand.py`.

- Content types `application/x.bitwarden.*`, the MAC domain separator `bitwarden.aes256-cbc-hmac-sha256-aead.v1`, and the `bitwarden-{name}` key-derivation salt.
- Test accounts at `@bitwarden.com`: the email is the key-derivation salt of the fixture, so changing it breaks the encrypted test data. `test-vectors/` is left whole.
- The client identification headers `Bitwarden-Client-Name`, `Bitwarden-Client-Version` and `Bitwarden-Package-Type`.
- JSON field names, API paths, cipher type numbers 1–8, and the words cipher, folder, collection, send and organization in code and on the wire. Vowkey's own item types are numbered from 100.
- Upstream links and the upstream authors' credit in manifests.

## What was cut

The commercial `bitwarden_license` crates (PAM, access connector, commercial vault), the Secrets Manager access-token crates, organization domain verification and managed settings are not part of this repository. The client constructors in `vowkey-wasm-internal` and `vowkey-uniffi` take no managed-settings argument.

Key Connector and enterprise policies are cut from the product too. Each app removes its use of them first; the SDK crates (`vowkey-api-key-connector`, `vowkey-policies`) are deleted once no tree uses them. Cuts are deletions, not feature flags.

## Command lines

Two command lines carry the name `vowkey`. `clients/apps/cli` (Node) is the complete one: login, unlock, sync, list, get, create, edit, delete, Send, import and export. The MCP server and the end-to-end scripts run it. `sdk/crates/vowkey` (Rust) is the one that replaces it command by command and takes its place when it reaches parity; today it covers config, status, sync, Send and generate.

## Run it

- `scripts/dev-server.sh [port]` runs `vowkey-server` on a scratch data folder, with the web app from `clients/` when it is built.
- `node scripts/create-account.mjs SERVER EMAIL PASSWORD` creates an account on a server with signups open. It makes the keys the way the web app does, because the server stores the legacy key-pair fields and not the SDK's newer account-keys payload.
- `scripts/apply-brand.mjs` writes the icons and logos of every app from `brand/`.

## Checks

`scripts/check.sh` runs on this machine; Vowkey uses no hosted CI or workflows. It takes component names (`scripts/check.sh sdk server`) and runs all components when given none. Run it on the final commit before a merge.

| Component | What it runs |
| --- | --- |
| `sdk` | the Rust workspace's tests |
| `server` | the server's tests |
| `mcp` | the MCP server's build and tests |
| `wasm` | the WebAssembly package build the web app, extension and desktop app link |
| `clients` | the Node clients' jest suites |
| `e2e-cli` | stores a login, a card and an identity through the Node command line against a fresh server and reads them back |
| `e2e-desktop` | opens the desktop app, logs in with a master password, and locks and unlocks, against a fresh server |
