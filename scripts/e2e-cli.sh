#!/usr/bin/env bash
# Stores a login, a card and an identity through the command line against a fresh vowkey-server
# and reads them back. Needs the WebAssembly package (sdk/crates/vowkey-wasm-internal/build.sh)
# and the Node command line build (npm run build:oss --workspace @vowkey/cli, in clients/).
set -euo pipefail

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
cli="$root/clients/apps/cli/build/vowkey.js"

[ -f "$cli" ] || (cd "$root/clients" && npm run build:oss --workspace @vowkey/cli)
source "$root/scripts/lib/test-server.sh"
start_test_server "$work"
server_pid="$TEST_SERVER_PID"

node "$root/scripts/create-account.mjs" "$TEST_SERVER_URL" "$email" "$password"

export VOWKEYCLI_APPDATA_DIR="$work/cli"
mkdir -p "$VOWKEYCLI_APPDATA_DIR"
vowkey() { node "$cli" "$@" --nointeraction; }

vowkey config server "$TEST_SERVER_URL" >/dev/null
vowkey login "$email" "$password" --raw >/dev/null
export VOWKEY_SESSION="$(vowkey unlock "$password" --raw)"
vowkey sync >/dev/null

template="$(vowkey get template item)"
create() {
  local encoded
  encoded="$(printf '%s' "$template" | jq -c "$1" | vowkey encode)"
  vowkey create item "$encoded" >/dev/null
}

create '.type=1 | .name="Example login" | .login={username:"linh", password:"hunter2-example", uris:[{match:null, uri:"https://example.com/login"}]}'
create '.type=3 | .name="Example card" | .login=null | .card={cardholderName:"Linh Nguyen", brand:"Visa", number:"4111111111111111", expMonth:"12", expYear:"2030", code:"123"}'
create '.type=4 | .name="Linh Nguyen" | .login=null | .identity={title:"Ms", firstName:"Linh", lastName:"Nguyen", email:"linh@example.com", passportNumber:"B1234567", address1:"1 Example St", city:"Hanoi", country:"VN", postalCode:"100000"}'

fail() { echo "FAILED: $1" >&2; exit 1; }

[ "$(vowkey list items | jq 'length')" = "3" ] || fail "expected 3 items in the vault"
[ "$(vowkey get password "Example login")" = "hunter2-example" ] || fail "login password did not read back"
[ "$(vowkey get item "Example card" | jq -r .card.number)" = "4111111111111111" ] || fail "card number did not read back"
[ "$(vowkey get item "Linh Nguyen" | jq -r .identity.passportNumber)" = "B1234567" ] || fail "passport number did not read back"

# A second session reads the same vault from the server.
rm -rf "$VOWKEYCLI_APPDATA_DIR" && mkdir -p "$VOWKEYCLI_APPDATA_DIR"
vowkey config server "$TEST_SERVER_URL" >/dev/null
vowkey login "$email" "$password" --raw >/dev/null
export VOWKEY_SESSION="$(vowkey unlock "$password" --raw)"
vowkey sync >/dev/null
[ "$(vowkey list items | jq 'length')" = "3" ] || fail "a new session did not see the 3 items"

echo "stored and read back a login, a card and an identity"
