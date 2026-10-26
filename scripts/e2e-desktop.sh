#!/usr/bin/env bash
# Runs the desktop app's end-to-end tests against a fresh vowkey-server: the app opens a window,
# logs in with a master password, and locks and unlocks. Needs the desktop app build
# (npm run build:dev --workspace @vowkey/desktop, in clients/), the native modules
# (npm run build-native --workspace @vowkey/desktop) and the WebAssembly package.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
work="$(mktemp -d)"
source "$root/scripts/lib/test-server.sh"
trap 'finish_e2e; rm -rf "$work"' EXIT

prepare_e2e_account "$work"
cd "$root/clients/e2e"
npx playwright test -c playwright.desktop.config.ts --reporter=line
