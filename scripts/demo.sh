#!/usr/bin/env bash
# Opens everything for a live demo on a fresh, empty vault: a local vowkey-server, the desktop app and
# a Chromium with the browser extension, both signed in to the same demo account, and the demo forms
# served at https://forms.test. Drop documents from the demo folder into the desktop window, then fill
# the forms in the browser. Ctrl+C stops it and discards the vault.
#   scripts/demo.sh           an empty vault
#   scripts/demo.sh --seed    with a login, a card and an identity already saved
# Needs the builds the end-to-end scripts need: the desktop app (npm run build:dev), the native
# modules (npm run build-native), the Chrome extension (npm run build:chrome --workspace @vowkey/browser)
# and the WebAssembly package. Reading documents needs the Decision key in the Mac keychain item
# typesafe.ai.jev, or VOWKEY_DECISION_KEY.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
work="$(mktemp -d)"
source "$root/scripts/lib/test-server.sh"
trap 'finish_e2e; rm -rf "$work"' EXIT

prepare_e2e_account "$work"
if [ "${1:-}" = "--seed" ]; then seed_vault "$work"; fi

# A filled PDF is saved next to the original; start each run without the copies of the last one.
demo_forms="${VOWKEY_DEMO:-$root/../vowkey/Demo}/live/forms/pdf"
[ -d "$demo_forms" ] && find "$demo_forms" -name "*(filled)*" -delete

echo
echo "Demo account: e2e@vowkey.test / e2e master password 1  (server $TEST_SERVER_URL)"
echo "Demo documents: ${VOWKEY_DEMO:-$root/../vowkey/Demo}/live/documents"
echo
cd "$root/clients/e2e"
npx playwright test -c playwright.demo.config.ts
