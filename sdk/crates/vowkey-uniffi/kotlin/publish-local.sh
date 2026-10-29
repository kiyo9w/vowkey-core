#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"
SDK_REPO_ROOT="$(realpath ../../..)"
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$SDK_REPO_ROOT/target}"
NDK_ROOT="${ANDROID_NDK_HOME:-${ANDROID_NDK_ROOT:-}}"
if [[ -z "$NDK_ROOT" ]]; then
    echo "Set ANDROID_NDK_HOME to the installed Android NDK directory." >&2
    exit 1
fi
case "$(uname -s)" in
    Darwin) NDK_HOST=darwin-x86_64 ;;
    Linux) NDK_HOST=linux-x86_64 ;;
    *) echo "Set up an Android NDK build on macOS or Linux." >&2; exit 1 ;;
esac
TOOLCHAIN="$NDK_ROOT/toolchains/llvm/prebuilt/$NDK_HOST/bin"
API_LEVEL="${ANDROID_API_LEVEL:-28}"

build_android() {
    local target="$1" abi="$2" compiler="$3"
    local target_env="${target//-/_}"
    local linker_env
    linker_env="$(printf '%s' "$target_env" | tr '[:lower:]' '[:upper:]')"
    local clang="$TOOLCHAIN/$compiler$API_LEVEL-clang"
    if [[ ! -x "$clang" ]]; then
        echo "Android NDK compiler not found: $clang" >&2
        exit 1
    fi
    env "CC_${target_env}=$clang" "AR_${target_env}=$TOOLCHAIN/llvm-ar" \
        "CARGO_TARGET_${linker_env}_LINKER=$clang" \
        cargo build --manifest-path "$SDK_REPO_ROOT/Cargo.toml" -p vowkey-uniffi --release --target "$target"
    mkdir -p "sdk/src/main/jniLibs/$abi"
    cp "$CARGO_TARGET_DIR/$target/release/libvowkey_uniffi.so" "sdk/src/main/jniLibs/$abi/libvowkey_uniffi.so"
}

build_android aarch64-linux-android arm64-v8a aarch64-linux-android
if [[ "${1:-}" == "all" ]]; then
    build_android armv7-linux-androideabi armeabi-v7a armv7a-linux-androideabi
    build_android x86_64-linux-android x86_64 x86_64-linux-android
    build_android i686-linux-android x86 i686-linux-android
fi

./build-schemas.sh
./gradlew sdk:publishToMavenLocal -Pversion=LOCAL
