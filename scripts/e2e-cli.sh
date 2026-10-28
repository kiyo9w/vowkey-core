#!/usr/bin/env bash
# Stores a login, a card and an identity through the command line against a fresh vowkey-server
# and reads them back. Needs the WebAssembly package (sdk/crates/vowkey-wasm-internal/build.sh)
# and the Node command line build (npm run build:oss --workspace @vowkey/cli, in clients/).
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
work="$(mktemp -d)"
server_pid=""
echo_pid=""
cleanup() {
  [ -n "$echo_pid" ] && kill "$echo_pid" 2>/dev/null || true
  [ -n "$server_pid" ] && kill "$server_pid" 2>/dev/null || true
  [ -S "$work/cli/secrets.sock" ] && node "$cli" --nointeraction secrets stop >/dev/null 2>&1 || true
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

# A key, an environment that lists it, and commands that receive the key.
create '.type=100 | .name="OpenAI" | .login=null | .apiKey={value:"sk-e2e-0123456789abcdef", sendStyle:"bearer", allowedHosts:["api.openai.com"]}'
key_id="$(vowkey list items --search OpenAI | jq -r '.[0].id')"
create ".type=101 | .name=\"production\" | .login=null | .environment={members:[{name:\"OPENAI_API_KEY\",itemId:\"$key_id\"}]}"
[ "$(vowkey get item "$key_id" | jq -r .apiKey.value)" = "sk-e2e-0123456789abcdef" ] || fail "key value did not read back"
[ "$(vowkey get item "$key_id" | jq -r '.apiKey.allowedHosts[0]')" = "api.openai.com" ] || fail "key host did not read back"
[ "$(vowkey get item production | jq -r '.environment.members[0].itemId')" = "$key_id" ] || fail "environment member did not read back"

# \`run\` takes everything after -- as the command, so it does not get the trailing --nointeraction.
run() { node "$cli" --nointeraction run "$@"; }
[ "$(run --environment production --no-masking -- sh -c 'printf %s "$OPENAI_API_KEY"')" = "sk-e2e-0123456789abcdef" ] || fail "run did not give the command the key"
[ "$(run --environment production -- sh -c 'printf "key=%s" "$OPENAI_API_KEY"')" = "key=<concealed by Vowkey>" ] || fail "run did not conceal the key in the command's output"
[ "$(run -- sh -c 'printf %s "${VOWKEY_SESSION:-none}"')" = "none" ] || fail "run passed the vault session to the command"
printf 'TOKEN=@vk:%s/key.value\nPLAIN=hello\n' "$key_id" >"$work/key.env"
[ "$(run --env-file "$work/key.env" --no-masking -- sh -c 'printf "%s %s" "$TOKEN" "$PLAIN"')" = "sk-e2e-0123456789abcdef hello" ] || fail "run did not resolve a reference in an env file"
printf 'TOKEN=another\n' >"$work/override.env"
[ "$(run --env-file "$work/key.env" --env-file "$work/override.env" --no-masking -- sh -c 'printf %s "$TOKEN"')" = "another" ] || fail "a later env file did not win"
printf 'BAD=@vk:00000000-0000-0000-0000-000000000000/key.value\n' >"$work/missing.env"
if run --env-file "$work/missing.env" -- touch "$work/spawned" 2>"$work/missing.err"; then fail "run started a command with a reference that does not resolve"; fi
[ ! -e "$work/spawned" ] || fail "run spawned a command after a reference failed"
grep -q "BAD: @vk:00000000-0000-0000-0000-000000000000/key.value" "$work/missing.err" || fail "run did not name the variable and the reference"
set +e; run -- sh -c 'exit 7'; code=$?; set -e
[ "$code" = "7" ] || fail "run did not pass on the command's exit code ($code)"

# `env references` prints references, never values.
[ "$(vowkey env references --environment production)" = "OPENAI_API_KEY=@vk:$key_id/key.value" ] || fail "env references did not print the reference"

# An enabled environment file is a regular 0600 file that exists while the vault is unlocked.
mkdir -p "$work/project"
env_path="$work/project/.env"
node "$cli" --nointeraction env file --environment production --path "$env_path" --enable >"$work/enable.out" || fail "enabling the environment file failed"
[ "$(jq -r .state "$work/enable.out")" = "written" ] || fail "the environment file was not written"
[ ! -L "$env_path" ] && [ -f "$env_path" ] || fail "the environment file is not a regular file"
[ "$(stat -f %Lp "$env_path" 2>/dev/null || stat -c %a "$env_path")" = "600" ] || fail "the environment file is not mode 0600"
grep -q '^OPENAI_API_KEY=sk-e2e-0123456789abcdef$' "$env_path" || fail "the environment file does not hold the resolved key"
head -1 "$env_path" | grep -q '^# Vowkey managed: ' || fail "the environment file has no ownership comment"
! grep -q 'sk-e2e' "$work/cli/developer-secrets.json" || fail "the state file holds a key value"

# Lock removes it; unlocking and enabling again writes it.
vowkey lock >/dev/null
[ ! -e "$env_path" ] || fail "lock did not remove the environment file"
export VOWKEY_SESSION="$(vowkey unlock "$password" --raw)"
node "$cli" --nointeraction env file --environment production --path "$env_path" --enable >/dev/null || fail "enabling again after unlock failed"
grep -q '^OPENAI_API_KEY=sk-e2e-0123456789abcdef$' "$env_path" || fail "the environment file was not written again"

# A file that is not Vowkey's is left alone.
printf 'MINE=1\n' >"$work/project/other.env"
create ".type=101 | .name=\"staging\" | .login=null | .environment={members:[{name:\"OPENAI_API_KEY\",itemId:\"$key_id\"}]}"
if node "$cli" --nointeraction env file --environment staging --path "$work/project/other.env" --enable >/dev/null 2>&1; then fail "an existing file that Vowkey did not write was replaced"; fi
[ "$(cat "$work/project/other.env")" = "MINE=1" ] || fail "an existing file was changed"

node "$cli" --nointeraction env file --environment production --disable >/dev/null || fail "disabling the environment file failed"
[ ! -e "$env_path" ] || fail "disable did not remove the environment file"

# The proxy attaches a key to a request for the key's host and to no other.
node "$root/scripts/lib/echo-origin.mjs" "$work/tls/key.pem" "$work/tls/cert.pem" "$work/ports" &
echo_pid=$!
for _ in $(seq 1 50); do [ -s "$work/ports" ] && break; sleep 0.1; done
read -r listed_port other_port <"$work/ports"
create ".type=100 | .name=\"Echo key\" | .login=null | .apiKey={value:\"echo-key-0123456789\", sendStyle:\"header\", headerName:\"X-Api-Key\", allowedHosts:[\"127.0.0.1:$listed_port\"]}"
echo_id="$(vowkey list items --search 'Echo key' | jq -r '.[0].id')"
node "$cli" --nointeraction proxy enable "$echo_id" >/dev/null || fail "turning the key on for the proxy failed"
# The first request verifies the certificate the proxy presents, so it passes only because the
# command was handed the device CA. The second goes to a host no key lists through a blind tunnel,
# so it reaches the origin's own self-signed certificate, which the test does not verify.
probe='const https=require("https");const get=(p,open)=>new Promise((ok,no)=>https.get("https://127.0.0.1:"+p+"/probe",{rejectUnauthorized:!open},(r)=>{let b="";r.on("data",(d)=>b+=d);r.on("end",()=>ok(JSON.parse(b)))}).on("error",no));(async()=>{const a=await get(process.argv[1],false);const b=await get(process.argv[2],true);console.log(JSON.stringify({listed:a.headers["x-api-key"]||null,other:b.headers["x-api-key"]||null}))})().catch((e)=>{console.error(e.message);process.exit(2)})'
seen="$(run --proxy -- node -e "$probe" "$listed_port" "$other_port")" || fail "a request through the proxy failed"
[ "$(echo "$seen" | jq -r .listed)" = "echo-key-0123456789" ] || fail "the proxy did not attach the key for its host ($seen)"
[ "$(echo "$seen" | jq -r .other)" = "null" ] || fail "the proxy attached a key to a host no key lists ($seen)"
[ "$(node "$cli" --nointeraction proxy status | jq -r .listening)" = "true" ] || fail "the proxy is not listening after run --proxy"
vowkey lock >/dev/null
[ "$(node "$cli" --nointeraction proxy status | jq -r .listening)" = "false" ] || fail "lock did not stop the proxy"
kill "$echo_pid" 2>/dev/null || true
export VOWKEY_SESSION="$(vowkey unlock "$password" --raw)"
node "$cli" --nointeraction secrets stop >/dev/null 2>&1 || true

# A second session reads the same vault from the server.
rm -rf "$VOWKEYCLI_APPDATA_DIR" && mkdir -p "$VOWKEYCLI_APPDATA_DIR"
vowkey config server "$TEST_SERVER_URL" >/dev/null
vowkey login "$email" "$password" --raw >/dev/null
export VOWKEY_SESSION="$(vowkey unlock "$password" --raw)"
vowkey sync >/dev/null
[ "$(vowkey list items | jq 'length')" = "7" ] || fail "a new session did not see the 7 items"
[ "$(vowkey get item "$key_id" | jq -r .apiKey.value)" = "sk-e2e-0123456789abcdef" ] || fail "a new session did not read the key"

echo "stored and read back a login, a card, an identity, a key and an environment, and ran commands with the key"
