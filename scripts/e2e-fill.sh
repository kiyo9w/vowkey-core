#!/usr/bin/env bash
# Fills a login, a card and an identity into pages in the browser extension, against a fresh
# vowkey-server. The vault is seeded through the command line, then the extension logs in, and the
# test runs the extension's autofill commands on forms served from https://forms.test.
# Needs the Chrome extension build (npm run build:prod:chrome --workspace @vowkey/browser).
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
work="$(mktemp -d)"
source "$root/scripts/lib/test-server.sh"
trap 'finish_e2e; rm -rf "$work"' EXIT

prepare_e2e_account "$work" "$root/clients/apps/web/build"
seed_vault "$work"
cd "$root/clients/e2e"
npx playwright test -c playwright.browser.config.ts tests/browser/fill --reporter=line
