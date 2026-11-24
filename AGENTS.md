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
| `relay/` | The relay between the apps and a Decision model: it holds the model's key, checks the account's token and keeps each account to its allowance | Vowkey |
| `brand/` | Vowkey's icon and marks, the source for every app icon and logo | Vowkey |

Each directory builds on its own (`cargo` in `sdk/` and `server/`, `npm` in `clients/` and `mcp/`, Xcode in `ios/`, Gradle in `android/`), keeps its own lockfile, and is checked by `scripts/check.sh`. The web app, extension and desktop app reach the core through the WebAssembly package built from `sdk/crates/vowkey-wasm-internal`; the phone apps reach it through the UniFFI bindings built from `sdk/crates/vowkey-uniffi`.

## Names

Crates, packages, binaries, apps and user-visible words say Vowkey.

- Rust crates: `vowkey-*`. npm scope: `@vowkey`. iOS app id: `com.classfunc.vowkey` (CLASSFUNC team `98VU36Q5CS`); Android app id: `com.vowkey.app`. CLI binary: `vowkey`, with `VOWKEY_*` environment variables (`VOWKEY_SESSION`, `VOWKEY_PASSWORD`). Server binary: `vowkey-server`.
- Apps use the icon and marks in `brand/`.
- The words people see follow `~/Documents/Projects/vowkey/LANGUAGE.md`: Bitwarden's Identity item is a profile on screen, a Secure note is a note, and a vault holds logins, cards, profiles and keys.
- Cloud hostnames that upstream pointed at Bitwarden's cloud now point at `vowkey.com` hosts (`vault.`, `api.`, `identity.`, `send.`). Each is a default in one place per component and is replaced when the real hosts exist.
- `scripts/rename-brand.py` applies these names to a freshly copied upstream tree. Use it for every tree that joins the repository so all of them follow one convention.

## What stays as Bitwarden wrote it

Vowkey syncs on Bitwarden's encryption and sync format. The following are part of that format, or are fixtures derived from it, and keep their upstream spelling. The list is `PROTECT` in `scripts/rename-brand.py`.

- Content types `application/x.bitwarden.*`, the MAC domain separator `bitwarden.aes256-cbc-hmac-sha256-aead.v1`, and the `bitwarden-{name}` key-derivation salt.
- Test accounts at `@bitwarden.com`: the email is the key-derivation salt of the fixture, so changing it breaks the encrypted test data. `test-vectors/` is left whole.
- Fixtures that pair ciphertext, a signed token or attestation bytes with the plaintext they decode to (the importers' encrypted vectors, JWT claims, WebAuthn attestations) keep upstream's plaintext. When a rename breaks one, restore the fixture from upstream instead of editing the expected values.
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
- The browser extension opens its bundled onboarding page after a user-initiated install. Setup stays inside the extension rather than visiting a marketing hostname.
- **Mac build gotchas:** On a 24 GB Mac, run desktop webpack sequentially (`build:oss:main:dev`, `build:oss:preload:dev`, `build:oss:renderer:dev` via `--workspace @vowkey/desktop` from `clients/`); parallel `build:dev` OOMs silently. After SDK changes, run `sdk/crates/vowkey-wasm-internal/build.sh` before typechecking the renderer (and avoid Electron renderer `process.env` reads). For Windows NSIS packaging on Apple Silicon without Rosetta 2, point `electron-builder` at Homebrew's Apple Silicon `makensis`. For iOS, generate with `LOCAL_SDK=true mint run xcodegen --spec project-bwk.yml` and `project-pm.yml` (drop the watch target in a local uncommitted copy if no watchOS simulator runtime is installed) and install `mint install SwiftGen/SwiftGen@6.6.3` once beforehand.

## Checks

`scripts/check.sh` runs on this machine; Vowkey uses no hosted CI or workflows. It takes component names (`scripts/check.sh sdk server`) and runs all components when given none. Run it on the final commit before a merge.

| Component | What it runs |
| --- | --- |
| `sdk` | the Rust workspace's tests |
| `server` | the server's tests |
| `mcp` | the MCP server's build and tests |
| `relay` | the relay's unit tests (`node --test`) |
| `push-relay` | installation registration, authenticated relay requests and provider delivery boundaries |
| `wasm` | the WebAssembly package build the web app, extension and desktop app link |
| `clients` | the Node clients' jest suites |
| `e2e-cli` | stores a login, a card and an identity through the Node command line against a fresh server and reads them back |
| `e2e-relay` | signs in to a fresh server, and sends requests through the relay with the access token it gives, to a stand-in model; refuses a missing or changed token and keeps an account to its allowance; with a Decision key in `RELAY_E2E_UPSTREAM_KEY` or the keychain item `typesafe.ai.jev`, one request also goes to the real Decision endpoint |
| `e2e-billing` | signed Paddle fixture webhooks, campaign cohorts, additive entitlements, daily/monthly allowance boundaries, credits and cancellation against a fresh server |
| `e2e-passkey` | real Chromium WebAuthn registration and sign-in without PRF, password-unlock fallback, sync authorization, replay rejection and credential revocation against a fresh server |
| `e2e-desktop` | opens the desktop app, logs in with a master password, and locks and unlocks with biometrics; drops the four demo documents and a passport photo into the bar and checks the profile they make; drops a photo whose print is too small to read and checks that nothing is saved and a closer photo is asked for; opens the pill from the icon, finds a detail and copies it; against a fresh server |
| `e2e-web` | opens the web app hosted by `vowkey-server`, logs in, and checks that a stored login, card and identity appear in the vault |
| `e2e-fill` | loads the browser extension in Chromium against a fresh server; fills logins, cards, profiles and the three Japanese demo forms; exercises detail versus whole-form intent and retained Indonesian address, Mexican arrival and Spanish product-registration captures |
| `e2e-loop` | on a fresh server the desktop app reads the four demo documents into one profile, then the browser extension fills the three demo forms from that profile |

Two scripts measure the matcher and run on request, not by default (`scripts/check.sh score-chromium score-corpus`). `score-chromium` compares it with Chrome's output on Chromium's 184 heuristics fixtures, which says how faithfully Chrome's behavior was ported for logins, addresses and cards. `score-corpus` runs it over the 72 expected-field files in `~/Documents/Projects/vowkey/corpus/` and says how often a printed label is matched to the right detail.

The browser's saved-profile-detail row fills only the chosen field in its frame. Fill whole form preserves existing values and manual corrections at the live write boundary, while allowing a later profile to replace this writer's unchanged fills. Choosing a saved detail explicitly can replace that field. Login and card replacement retain their existing behavior.

The field menu shares one background owner between startup and login. Tab invalidation and iframe disconnection affect only their own current targets; the list requests its current suggestions after its nested iframe initializes.

Browser field names prefer explicit labels, then row, left and top labels in that order; neighboring hints do not override a stronger label. ArrowDown focus requests wait for the nested menu frame to load.

The PDF filler runs Python (`pypdf` and `cryptography`). `scripts/check.sh sdk` builds an environment for it under `sdk/target/pdf-tools`; elsewhere `VOWKEY_PYTHON` names an interpreter that has both. The tests that need the form corpus find it next to this repository, or at `VOWKEY_CORPUS`, and fail when it is missing.

The desktop app reads documents with `clients/apps/desktop/desktop_native/ocr/vowkey-read`: PDF text layers first, then local macOS text recognition for images and scanned pages. Recognition starts with automatic language detection and compares script-specific readings when the first pass is uncertain. The helper also lists form fields with their printed labels (`--form`), writes filled copies (`--fill`), and names the file in the window in front (`--front`).

Desktop keeps the reader alive through `--serve` and shares image analysis by file digest across classification, reading and filling. Placement keys such as `box:…:cell` identify where to write, not what a field asks for; numbered subfields retain their enclosing section. Semantic filling asks about unresolved fields even when the rest of a PDF, Word or Excel form already filled locally.

Document previews renew attachment download URLs through the authenticated SDK before fetching. The desktop, web and extension builds bundle PDF.js character maps, fonts, decoders and color profiles, so Japanese text and other embedded PDF content render without fetching viewer resources from a CDN. The clients use Zone.js 0.16, which supports the Promise APIs PDF.js uses.

The desktop account menu exposes Generator, Import and Export; Send is in the sidebar. New → Document opens the detail-search sheet, whose Add document button opens the file chooser. Dropping a PDF form saves a numbered filled copy beside the original, or in Downloads when that folder is not writable, and asks the operating system to open it. Restarting the live demo resets its vault but preserves filled copies.

The Vowkey icon sits in the macOS menu bar and the Windows taskbar. Clicking it, or pressing ⌃⇧Space, opens the case pill from `~/Documents/Projects/vowkey/design/interaction-models.html`: a transparent always-on-top window (`src/quick-bar/`) under the icon on a Mac and above the taskbar on Windows. It searches the vault and types the chosen detail into the app in front (macOS asks once for Accessibility), copies it, takes a dropped document or form, and fills the PDF, Word, Excel or Hangul form open in the window in front. The pill holds no vault data of its own: it asks the main window, which holds the unlocked vault. `npm run build-native` compiles it on macOS, and the packaged app carries it in its resources. Other systems report that reading documents is not available yet. `VOWKEY_E2E=1` skips opening filled copies in their default application.
