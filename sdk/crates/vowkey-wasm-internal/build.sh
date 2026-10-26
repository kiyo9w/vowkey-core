#!/usr/bin/env bash
set -eo pipefail

cd "$(dirname "$0")"

# Move to the root of the repository
cd ../../

# Write VERSION file
git rev-parse HEAD > ./crates/vowkey-wasm-internal/npm/VERSION


# Parse flags
NPM_FOLDER="npm"
RELEASE_FLAG=""
BUILD_FOLDER="debug"
# Dev-only: exposes the hand-rolled debug-capability tree (client.debug()) to JS.
# Never enable for production builds.
DEBUG_CAPABILITIES_FEATURE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    -r)
      RELEASE_FLAG="--release"
      BUILD_FOLDER="release"
      ;;
    -d)
      DEBUG_CAPABILITIES_FEATURE="--features debug-capabilities"
      ;;
  esac
  shift
done

if [ -n "$RELEASE_FLAG" ]; then
  echo "Building in release mode"
else
  echo "Building in debug mode"
fi

# The shipped .wasm files enable SIMD and other post-MVP features, which make decryption and Argon2
# notably faster. The wasm2js fallback supports MVP only, so it is transpiled from a second, MVP
# build. Both feature sets leave out reference-types and multi-value: those change the JS glue that
# wasm-bindgen generates, and both builds must share one glue file (checked below).
# Note that this requires build-std which is an unstable feature,
# this normally requires a nightly build, but we can also use the
# RUSTC_BOOTSTRAP hack to use the same stable version as the normal build
SIMD_CPU="-Ctarget-cpu=mvp -Ctarget-feature=+simd128,+bulk-memory,+sign-ext,+nontrapping-fptoint,+mutable-globals"
MVP_CPU="-Ctarget-cpu=mvp"
MVP_TARGET_DIR="./target/wasm-mvp"
MVP_BINDGEN_DIR="${MVP_TARGET_DIR}/bindgen"

build_wasm() {
  local cpu="$1"
  local target_dir="$2"
  RUSTFLAGS="${cpu} --cfg getrandom_backend=\"wasm_js\"" RUSTC_BOOTSTRAP=1 cargo build -p vowkey-wasm-internal -Zbuild-std=panic_abort,std --target wasm32-unknown-unknown --target-dir "${target_dir}" ${RELEASE_FLAG} ${DEBUG_CAPABILITIES_FEATURE}
}

build_wasm "${SIMD_CPU}" ./target

cargo run -p wasm-bindgen-cli-runner --bin wasm-bindgen-runner -- --target bundler --out-dir crates/vowkey-wasm-internal/${NPM_FOLDER} ./target/wasm32-unknown-unknown/${BUILD_FOLDER}/vowkey_wasm_internal.wasm
cargo run -p wasm-bindgen-cli-runner --bin wasm-bindgen-runner -- --target nodejs --out-dir crates/vowkey-wasm-internal/${NPM_FOLDER}/node ./target/wasm32-unknown-unknown/${BUILD_FOLDER}/vowkey_wasm_internal.wasm
# Format TypeScript definition files only (skip generated .wasm.js files)
npx prettier --write "./crates/vowkey-wasm-internal/${NPM_FOLDER}/**/*.ts"

# Optimize size, then build the MVP binary and transpile it to JS. Debug builds skip this to save
# build time, and write a stub instead so bundlers importing the fallback still resolve it.
if [ -z "$RELEASE_FLAG" ]; then
  echo 'throw new Error("wasm2js fallback is not built in debug mode, use build.sh -r");' > ./crates/vowkey-wasm-internal/${NPM_FOLDER}/vowkey_wasm_internal_bg.wasm.js
else
  wasm-opt -Os ./crates/vowkey-wasm-internal/${NPM_FOLDER}/vowkey_wasm_internal_bg.wasm -o ./crates/vowkey-wasm-internal/${NPM_FOLDER}/vowkey_wasm_internal_bg.wasm
  wasm-opt -Os ./crates/vowkey-wasm-internal/${NPM_FOLDER}/node/vowkey_wasm_internal_bg.wasm -o ./crates/vowkey-wasm-internal/${NPM_FOLDER}/node/vowkey_wasm_internal_bg.wasm

  build_wasm "${MVP_CPU}" "${MVP_TARGET_DIR}"
  rm -rf "${MVP_BINDGEN_DIR}"
  cargo run -p wasm-bindgen-cli-runner --bin wasm-bindgen-runner -- --target bundler --out-dir "${MVP_BINDGEN_DIR}" ${MVP_TARGET_DIR}/wasm32-unknown-unknown/${BUILD_FOLDER}/vowkey_wasm_internal.wasm

  # The wasm2js fallback is loaded through the glue generated for the SIMD build
  if ! cmp -s "${MVP_BINDGEN_DIR}/vowkey_wasm_internal_bg.js" "crates/vowkey-wasm-internal/${NPM_FOLDER}/vowkey_wasm_internal_bg.js"; then
    echo "error: MVP and SIMD builds produced different wasm-bindgen glue" >&2
    exit 1
  fi

  wasm-opt -Os ${MVP_BINDGEN_DIR}/vowkey_wasm_internal_bg.wasm -o ${MVP_BINDGEN_DIR}/vowkey_wasm_internal_bg.wasm
  wasm2js -Os ${MVP_BINDGEN_DIR}/vowkey_wasm_internal_bg.wasm -o ./crates/vowkey-wasm-internal/${NPM_FOLDER}/vowkey_wasm_internal_bg.wasm.js
  npx terser ./crates/vowkey-wasm-internal/${NPM_FOLDER}/vowkey_wasm_internal_bg.wasm.js -o ./crates/vowkey-wasm-internal/${NPM_FOLDER}/vowkey_wasm_internal_bg.wasm.js
fi

# Typecheck the generated TypeScript definitions
cd crates/vowkey-wasm-internal/${NPM_FOLDER}
npm ci
npx tsc --noEmit --lib es2020,dom,ESNext.Disposable vowkey_wasm_internal.d.ts
