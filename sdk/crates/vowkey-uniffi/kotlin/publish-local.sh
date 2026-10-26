#!/usr/bin/env bash
set -eo pipefail

cd "$(dirname "$0")"

SDK_REPO_ROOT="$(git rev-parse --show-toplevel)"

mkdir -p ./sdk/src/main/jniLibs/{arm64-v8a,armeabi-v7a,x86_64,x86}

# Build arm64 for emulator
cargo bin cross build -p vowkey-uniffi --release --target=aarch64-linux-android
mv $SDK_REPO_ROOT/target/aarch64-linux-android/release/libvowkey_uniffi.so ./sdk/src/main/jniLibs/arm64-v8a/libvowkey_uniffi.so

# Build other archs
if [ "$1" = "all" ]; then
    echo "Building for all architectures"
    
    cargo bin cross build -p vowkey-uniffi --release --target=armv7-linux-androideabi
    mv $SDK_REPO_ROOT/target/armv7-linux-androideabi/release/libvowkey_uniffi.so ./sdk/src/main/jniLibs/armeabi-v7a/libvowkey_uniffi.so

    cargo bin cross build -p vowkey-uniffi --release --target=x86_64-linux-android
    mv $SDK_REPO_ROOT/target/x86_64-linux-android/release/libvowkey_uniffi.so ./sdk/src/main/jniLibs/x86_64/libvowkey_uniffi.so

    cargo bin cross build -p vowkey-uniffi --release --target=i686-linux-android
    mv $SDK_REPO_ROOT/target/i686-linux-android/release/libvowkey_uniffi.so ./sdk/src/main/jniLibs/x86/libvowkey_uniffi.so
fi

# Generate latest bindings
./build-schemas.sh

# Publish to local maven (~/.m2/repository/com/vowkey/sdk-android)
./gradlew sdk:publishToMavenLocal -Pversion=LOCAL
