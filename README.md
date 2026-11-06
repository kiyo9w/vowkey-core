# Vowkey core

Vowkey reads the facts in people's documents, keeps them with logins, passkeys and API keys in an encrypted vault, and fills them wherever a form asks: websites, desktop apps, PDF, Word and Excel files, and tasks run by AI agents.

This repository holds the implementation, forked from Bitwarden. [AGENTS.md](AGENTS.md) says how it is laid out, named and checked.

## Build

```sh
cd sdk && cargo build --workspace --exclude vowkey-wasm-internal
cd server && cargo build --features sqlite
```

## Desktop

From `clients/apps/desktop`, `npm run build:oss:renderer` builds the desktop interface. Profiles expand the selected profile's documents vertically; All items and Documents keep flat lists. Searching for a profile by name keeps its details visible, while searching for a detail filters the matching fields. Adding a document opens that new source in the selected profile.

Prepared web controls and PDF widgets can bind a field directly with `vowkey:OWNER:ATTRIBUTE`, with an optional `#suffix` for repeated controls. The binding contains no answer: the matcher resolves current permission-filtered profile and role values. Fully bound PDFs do not request OCR or semantic inference, including when a fact is missing or denied. Ordinary forms retain their normal matching paths.

In Smart assist, complete Korean health eligibility certificates can be read directly from native OCR label/value boxes. The reader preserves leading zeros, distinguishes Korean registration numbers from national IDs, and falls back to the ordinary reader for incomplete or unfamiliar layouts. It does not recognize filenames, document hashes or seeded answers.

Decrypted cipher caches are bound to each account's encrypted snapshot version. Storage changes invalidate older facts, and a late decryption cannot populate the cache for a newer snapshot.
