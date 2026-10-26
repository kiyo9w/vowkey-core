# Vowkey SDK

The Rust core behind every Vowkey app: encryption, vault, sync, state, sign-in, Send, passkeys, generators, importers and exporters, with bindings for the web (WebAssembly), iOS and Android (UniFFI) and a `vowkey` command line.

## Crates

- [`vowkey-crypto`](./crates/vowkey-crypto): encryption and key handling.
- [`vowkey-core`](./crates/vowkey-core): the client and the pieces the other crates share.
- [`vowkey-vault`](./crates/vowkey-vault), [`vowkey-send`](./crates/vowkey-send), [`vowkey-fido`](./crates/vowkey-fido), [`vowkey-generators`](./crates/vowkey-generators), [`vowkey-importers`](./crates/vowkey-importers), [`vowkey-exporters`](./crates/vowkey-exporters): what a vault does.
- [`vowkey-api-api`](./crates/vowkey-api-api) and [`vowkey-api-identity`](./crates/vowkey-api-identity): generated bindings for the server's API.
- [`vowkey-wasm-internal`](./crates/vowkey-wasm-internal): WebAssembly bindings for the web app, the browser extension and the desktop app.
- [`vowkey-uniffi`](./crates/vowkey-uniffi): Swift and Kotlin bindings for the phone apps.
- [`vowkey`](./crates/vowkey): the command line.

## Build

Rust stable (installed with [rustup](https://rustup.rs/)), plus Node.js for the WebAssembly package.

```sh
cargo build --workspace --exclude vowkey-wasm-internal
cargo test --workspace --exclude vowkey-wasm-internal --exclude memory-testing
```

The WebAssembly package builds with `crates/vowkey-wasm-internal/build.sh` (add `-r` for release) and is linked into `../clients` with `npm link`. The phone bindings build with the scripts under `crates/vowkey-uniffi/swift` and `crates/vowkey-uniffi/kotlin`; their READMEs say how each app links the result.
