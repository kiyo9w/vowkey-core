# vowkey-wasm-internal

**Note:** This is only for internal use. Vowkey will not provide any support for this crate.

Vowkey WASM internal exposes WebAssembly bindings for the Vowkey SDK. This crate should
contain no logic but rather only handle WASM unique conversions and bindings. Business logic
**MUST** be placed in the relevant feature crates.

## Getting Started

### Requirements

- `wasm32-unknown-unknown` rust target.
- `binaryen` installed for `wasm-opt` and `wasm2js`.
- npm packages must be installed in the `npm` folder. Run `npm ci` inside:
  - **OSS:** `crates/vowkey-wasm-internal/npm`
  - **Commercial:** `crates/vowkey-wasm-internal/vowkey_license/npm`

```bash
rustup target add wasm32-unknown-unknown
brew install binaryen
```

### Building

```bash
# dev
./build.sh

# dev with commercial license
./build.sh -b

# release
./build.sh -r

# release with commercial license
./build.sh -r -b
```
