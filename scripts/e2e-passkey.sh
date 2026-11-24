#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
work="$(mktemp -d)"
cleanup() {
  local result=$?
  if [ -n "${TEST_SERVER_PID:-}" ]; then kill "$TEST_SERVER_PID" 2>/dev/null || true; fi
  if [ "$result" -eq 0 ]; then rm -rf "$work"; else printf 'Passkey replay artifacts: %s\n' "$work" >&2; fi
  return "$result"
}
trap cleanup EXIT
export DATABASE_URL="sqlite://$work/passkey.sqlite3"
source "$root/scripts/lib/test-server.sh"
start_test_server "$work"
email="passkey@vowkey.test"
password="passkey replay master password 1"
node "$root/scripts/create-account.mjs" "$TEST_SERVER_URL" "$email" "$password"
node "$root/scripts/e2e-passkey.mjs" "$TEST_SERVER_URL" "$email" "$password"
