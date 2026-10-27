#!/usr/bin/env bash
# Starts a fresh vowkey-server, signs in to it, and sends requests through the relay with the
# access token the server gives, to a stand-in model. Needs the WebAssembly package
# (sdk/crates/vowkey-wasm-internal/build.sh), for creating the account.
# With a key for the Decision endpoint, from RELAY_E2E_UPSTREAM_KEY or on a Mac from the keychain item
# typesafe.ai.jev, one request also goes to the real model.
set -euo pipefail

if [ -z "${RELAY_E2E_UPSTREAM_KEY:-}" ] && command -v security >/dev/null 2>&1; then
  RELAY_E2E_UPSTREAM_KEY="$(security find-generic-password -a "$USER" -s typesafe.ai.jev -w 2>/dev/null || true)"
fi
export RELAY_E2E_UPSTREAM_KEY

root="$(cd "$(dirname "$0")/.." && pwd)"
work="$(mktemp -d)"
server_pid=""
cleanup() {
  [ -n "$server_pid" ] && kill "$server_pid" 2>/dev/null || true
  rm -rf "$work"
}
trap cleanup EXIT

email="e2e@vowkey.test"
password="e2e master password 1"

source "$root/scripts/lib/test-server.sh"
start_test_server "$work"
server_pid="$TEST_SERVER_PID"

node "$root/scripts/create-account.mjs" "$TEST_SERVER_URL" "$email" "$password"

# The relay checks tokens with the server's public key, made from the private key the server keeps.
openssl rsa -in "$work/server/rsa_key.pem" -pubout -out "$work/token-public.pem" 2>/dev/null

RELAY_TOKEN_PUBLIC_KEY="$work/token-public.pem" RELAY_TOKEN_ISSUER="$TEST_SERVER_URL|login" \
  node "$root/scripts/e2e-relay.mjs" "$TEST_SERVER_URL" "$email" "$password"
