#!/usr/bin/env bash
# Takes the demo documents all the way to filled forms. On a fresh vowkey-server the desktop app
# reads the four demo documents (PDFs with a text layer) into one profile, then the browser
# extension logs in to the same account and fills the three demo forms from that profile.
# Needs the desktop build and its native modules (npm run build-native && npm run build:dev in
# clients/apps/desktop), the Chrome extension build (npm run build:prod:chrome --workspace
# @vowkey/browser), the web app build, and the WebAssembly package. The documents and forms are in
# ~/Documents/Projects/vowkey/Demo (VOWKEY_DEMO names another folder).
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
work="$(mktemp -d)"
source "$root/scripts/lib/test-server.sh"
trap 'finish_e2e; rm -rf "$work"' EXIT

prepare_e2e_account "$work" "$root/clients/apps/web/build"
cd "$root/clients/e2e"
npx playwright test -c playwright.desktop.config.ts tests/desktop/capture/demo-documents.e2e.ts --reporter=line
npx playwright test -c playwright.loop.config.ts --reporter=line
