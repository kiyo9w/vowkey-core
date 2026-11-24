#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
work="$(mktemp -d)"
cleanup() {
  local result=$?
  if [ -n "${TEST_SERVER_PID:-}" ]; then kill "$TEST_SERVER_PID" 2>/dev/null || true; fi
  if [ "$result" -eq 0 ]; then
    rm -rf "$work"
  else
    printf 'Billing replay artifacts: %s\n' "$work" >&2
  fi
  return "$result"
}
trap cleanup EXIT
export DATABASE_URL="sqlite://$work/billing.sqlite3"
export BILLING_PROVIDER=paddle PADDLE_ENVIRONMENT=sandbox
export PADDLE_WEBHOOK_SECRET="$(openssl rand -hex 32)"
export BILLING_PRICE_MAP='{"pri_family":{"plan_code":"family","kind":"base"},"pri_storage":{"plan_code":"storage_plus","kind":"addon"},"pri_hosted":{"plan_code":"hosted_agent","kind":"addon"},"pri_credits":{"plan_code":"hosted_agent","kind":"addon","credit_units":2}}'
source "$root/scripts/lib/test-server.sh"
start_test_server "$work"
email="billing@vowkey.test"
password="billing replay master password 1"
node "$root/scripts/create-account.mjs" "$TEST_SERVER_URL" "$email" "$password" launch
node "$root/scripts/e2e-billing.mjs" "$TEST_SERVER_URL" "$email" "$password" "$work/billing.sqlite3"
