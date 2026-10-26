#!/usr/bin/env bash
# Runs the web app's and the browser extension's end-to-end tests against a fresh vowkey-server
# that serves the web app: each logs in with a master password. Needs the web app build
# (npm run build:oss:selfhost:prod --workspace @vowkey/web-vault, in clients/), the Chrome extension
# build (npm run build:prod:chrome --workspace @vowkey/browser) and the WebAssembly package.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
work="$(mktemp -d)"
source "$root/scripts/lib/test-server.sh"
trap 'finish_e2e; rm -rf "$work"' EXIT

prepare_e2e_account "$work" "$root/clients/apps/web/build"
cd "$root/clients/e2e"
npx playwright test -c playwright.web.config.ts tests/web/login --reporter=line
npx playwright test -c playwright.browser.config.ts tests/browser/login --reporter=line
