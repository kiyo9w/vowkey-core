# Vowkey core

Vowkey reads the facts in people's documents, keeps them with logins, passkeys and API keys in an encrypted vault, and fills them wherever a form asks: websites, desktop apps, PDF, Word and Excel files, and tasks run by AI agents.

This repository holds the implementation, forked from Bitwarden. [AGENTS.md](AGENTS.md) says how it is laid out, named and checked.

## Build

```sh
cd sdk && cargo build --workspace --exclude vowkey-wasm-internal
cd server && cargo build --features sqlite
```
