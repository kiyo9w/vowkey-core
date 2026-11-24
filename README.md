# Vowkey core

Vowkey reads the facts in people's documents, keeps them with logins, passkeys and API keys in an encrypted vault, and fills them wherever a form asks: websites, desktop apps, PDF, Word and Excel files, and tasks run by AI agents.

This repository holds the implementation, forked from Bitwarden. [AGENTS.md](AGENTS.md) says how it is laid out, named and checked; product direction, specs, and the multi-horizon roadmap (`docs/FUTURE-VISION.md`) live in `~/Documents/Projects/vowkey`.

## Build

```sh
cd sdk && cargo build --workspace --exclude vowkey-wasm-internal
cd server && cargo build --features sqlite
```

## Desktop

From `clients/apps/desktop`, `npm run build:oss:renderer` builds the desktop interface. Profiles expand the selected profile's documents vertically; All items and Documents keep flat lists. Searching for a profile by name keeps its details visible, while searching for a detail filters the matching fields. Adding a document opens that new source in the selected profile.

Settings keeps optional on-device model setup behind a disclosure, which opens when local reading is selected. Settings and the model picker keep keyboard focus inside the dialog and return it on close. A detail's AI rule changes on screen after its save completes.

Account document originals download in the background after unlock and are retained as ciphertext in account-scoped local storage. Opening a saved document reads that copy before requesting a download URL. Locking clears decrypted preview memory without deleting encrypted originals, so a completed download remains usable after an offline restart. Initial sign-in and documents that have not finished downloading still require a connection.

Normal browser autofill matches saved details locally. The separate AI mode asks an agent to handle complex fields; it is not the offline path. A document's storage being offline does not imply that a new image can be analysed without an installed local model.

Prepared web controls and PDF widgets can bind a field directly with `vowkey:OWNER:ATTRIBUTE`, with an optional `#suffix` for repeated controls. The binding contains no answer: the matcher resolves current permission-filtered profile and role values. Fully bound PDFs do not request OCR or semantic inference, including when a fact is missing or denied. Ordinary forms retain their normal matching paths.

The local form matcher recognises school, faculty, student number, school phone and account-opening purpose fields. Account purpose is filled only from a saved `bank.account.purpose` value; it does not infer the person's intent or substitute it for travel or other purposes.

In Smart assist, complete Korean health eligibility certificates can be read directly from native OCR label/value boxes. The reader preserves leading zeros, distinguishes Korean registration numbers from national IDs, and falls back to the ordinary reader for incomplete or unfamiliar layouts. It does not recognize filenames, document hashes or seeded answers.

Decrypted cipher caches are bound to each account's encrypted snapshot version. Storage changes invalidate older facts, and a late decryption cannot populate the cache for a newer snapshot.

## Business services

[Account sign-in](docs/operations/accounts.md), [plans and allowances](docs/operations/entitlements.md), [mail](docs/operations/mail.md), [push](docs/operations/push.md), and [crash reports](docs/operations/crash-reports.md) describe the configured services. [Hosting](docs/operations/hosting.md) covers the shared stack and encrypted restore drill; [monitoring](docs/operations/monitoring.md) covers external checks and job heartbeats. [Release decisions](docs/operations/release-decisions.md) separates the implementation from owner-held commercial, domain, audit and publication choices.
