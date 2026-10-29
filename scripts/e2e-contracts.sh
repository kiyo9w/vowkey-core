#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
work="$(mktemp -d)"
cleanup() {
  local test_status=$?
  if [ "$test_status" -ne 0 ] && [ -f "$work/server.log" ]; then
    cp "$work/server.log" "${TMPDIR:-/tmp}/vowkey-contracts-server.log"
  fi
  [ -n "${TEST_SERVER_PID:-}" ] && kill "$TEST_SERVER_PID" 2>/dev/null || true
  rm -rf "$work"
}
trap cleanup EXIT
source "$root/scripts/lib/test-server.sh"
start_test_server "$work"
export VOWKEY_TEST_SERVER="$TEST_SERVER_URL"
export VOWKEY_TEST_EMAIL="contracts@vowkey.test"
export VOWKEY_TEST_PASSWORD="contracts end-to-end password"
node "$root/scripts/create-account.mjs" "$TEST_SERVER_URL" "$VOWKEY_TEST_EMAIL" "$VOWKEY_TEST_PASSWORD"
cd "$root/clients"
node node_modules/jest/bin/jest.js --config apps/cli/jest.config.js --runInBand --ci --coverage=false \
  --testMatch '**/contracts.e2e.ts'
