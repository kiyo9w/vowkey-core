# Vowkey server

The sync server behind Vowkey's apps, written in Rust. It speaks the Bitwarden client API, so the web app, browser extension, desktop app, phone apps and CLI sign in, sync and share through it.

It serves:

- accounts, devices and sign-in with two-step options (authenticator, email, FIDO2, YubiKey, Duo)
- the encrypted vault: logins, cards, identities, notes and SSH keys, with folders, attachments and history
- organizations with collections, groups, member roles and event logs
- Send, emergency access and the admin page
- website icons
- the web app, from the folder named by `WEB_VAULT_FOLDER`

## Build

SQLite, MySQL and PostgreSQL are supported; pick at least one feature.

```sh
cargo build --release --features sqlite
cargo test --features sqlite
```

## Run

Copy `.env.template` to `.env` and set `DOMAIN` to the address the apps will use. Every setting is listed there and on the admin page.

```sh
./target/release/vowkey-server
```

The server listens on port 80 by default, keeps its data in `data/`, and expects the web app at `web-vault/` next to the binary. Put it behind HTTPS: the browser extension and the phone apps require it.

## Container

`docker/` holds the Dockerfiles and bake files for Debian and Alpine images.

## Tests

`playwright/` runs the end-to-end tests against a running server.

## License

AGPL-3.0-only, as the server it is forked from, [Vaultwarden](https://github.com/dani-garcia/vaultwarden) by Daniel García and contributors.
