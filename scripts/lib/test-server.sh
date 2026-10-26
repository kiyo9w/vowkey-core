# Sourced by the end-to-end scripts. Starts vowkey-server on a free port with a self-signed
# certificate for localhost and the legacy account keys the apps expect.
#   start_test_server WORKDIR [WEB_APP_FOLDER]
# sets TEST_SERVER_URL and TEST_SERVER_PID, and trusts the certificate for Node processes.

start_test_server() {
  local work="$1" web="${2:-}" port tls="$1/tls"
  local root
  root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

  port="$(python3 -c 'import socket; s = socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1])')"
  mkdir -p "$tls"
  openssl req -x509 -newkey rsa:2048 -nodes -days 2 -subj "/CN=localhost" \
    -addext "subjectAltName=DNS:localhost,IP:127.0.0.1" \
    -keyout "$tls/key.pem" -out "$tls/cert.pem" 2>/dev/null
  (cd "$root/server" && cargo build --features sqlite)

  local web_enabled=true
  [ -n "$web" ] && [ -f "$web/index.html" ] || web_enabled=false
  DOMAIN="https://localhost:$port" ROCKET_ADDRESS=127.0.0.1 ROCKET_PORT="$port" \
    ROCKET_TLS="{certs=\"$tls/cert.pem\",key=\"$tls/key.pem\"}" \
    DATA_FOLDER="$work/server" WEB_VAULT_FOLDER="${web:-$work/none}" WEB_VAULT_ENABLED="$web_enabled" \
    SIGNUPS_ALLOWED=true \
    "$root/server/target/debug/vowkey-server" >"$work/server.log" 2>&1 &
  TEST_SERVER_PID=$!
  TEST_SERVER_URL="https://localhost:$port"
  export NODE_EXTRA_CA_CERTS="$tls/cert.pem"
  for _ in $(seq 1 60); do
    curl -sf --cacert "$tls/cert.pem" "$TEST_SERVER_URL/api/alive" >/dev/null && return 0
    sleep 0.5
  done
  echo "vowkey-server did not start; see $work/server.log" >&2
  return 1
}

# Starts a server, creates the test account on it, and points the clients' end-to-end suite at it
# through clients/.debug/credentials.txt (the file is restored when the script ends).
#   prepare_e2e_account WORKDIR [WEB_APP_FOLDER]
# sets E2E_ACCOUNT for the Playwright run.
prepare_e2e_account() {
  local work="$1" web="${2:-}"
  local root credentials
  root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
  credentials="$root/clients/.debug/credentials.txt"
  local email="e2e@vowkey.test" password="e2e master password 1"

  start_test_server "$work" "$web"
  node "$root/scripts/create-account.mjs" "$TEST_SERVER_URL" "$email" "$password"

  mkdir -p "$(dirname "$credentials")"
  if [ -f "$credentials" ]; then cp "$credentials" "$work/credentials.saved"; fi
  printf '[check]\nemail=%s\npassword=%s\nserver=%s\n' "$email" "$password" "$TEST_SERVER_URL" >"$credentials"
  E2E_CREDENTIALS_FILE="$credentials"
  E2E_CREDENTIALS_SAVED="$work/credentials.saved"
  export E2E_ACCOUNT=check
}

# Stops the server and puts the clients' credentials file back.
finish_e2e() {
  [ -n "${TEST_SERVER_PID:-}" ] && kill "$TEST_SERVER_PID" 2>/dev/null || true
  if [ -n "${E2E_CREDENTIALS_FILE:-}" ]; then
    if [ -f "$E2E_CREDENTIALS_SAVED" ]; then cp "$E2E_CREDENTIALS_SAVED" "$E2E_CREDENTIALS_FILE"; else rm -f "$E2E_CREDENTIALS_FILE"; fi
  fi
}

# Stores a login, a card and an identity in the test account through the Node command line.
#   seed_vault WORKDIR
# The login is for https://forms.test, the host the end-to-end fill pages are served from.
seed_vault() {
  local work="$1" root cli email="e2e@vowkey.test" password="e2e master password 1"
  root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
  cli="$root/clients/apps/cli/build/vowkey.js"
  [ -f "$cli" ] || (cd "$root/clients" && npm run build:oss --workspace @vowkey/cli)

  local appdata="$work/cli"
  mkdir -p "$appdata"
  vowkey() { VOWKEYCLI_APPDATA_DIR="$appdata" node "$cli" "$@" --nointeraction; }

  vowkey config server "$TEST_SERVER_URL" >/dev/null
  vowkey login "$email" "$password" --raw >/dev/null
  export VOWKEY_SESSION="$(vowkey unlock "$password" --raw)"
  vowkey sync >/dev/null

  local template
  template="$(vowkey get template item)"
  create_item() {
    local encoded
    encoded="$(printf '%s' "$template" | jq -c "$1" | vowkey encode)"
    vowkey create item "$encoded" >/dev/null
  }

  create_item '.type=1 | .name="Forms login" | .login={username:"linh.nguyen", password:"hunter2-example", uris:[{match:null, uri:"https://forms.test/login"}]}'
  create_item '.type=3 | .name="Forms card" | .login=null | .card={cardholderName:"Linh Nguyen", brand:"Visa", number:"4111111111111111", expMonth:"12", expYear:"2030", code:"123"}'
  create_item '.type=4 | .name="Linh Nguyen" | .login=null | .identity={title:"Ms", firstName:"Linh", middleName:"Thuy", lastName:"Nguyen", email:"linh@example.com", phone:"+81 90 1234 5678", address1:"1-2-3 Shinjuku", city:"Shinjuku-ku", state:"Tokyo", postalCode:"160-0022", country:"JP", company:"Tsubame Cloud", username:"linh.nguyen", passportNumber:"B1234567", licenseNumber:"D9999", ssn:"123-45-6789"}'
  unset VOWKEY_SESSION
}
