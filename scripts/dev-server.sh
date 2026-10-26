#!/usr/bin/env bash
# Runs vowkey-server on a scratch data folder, serving the web app built by clients/.
#   scripts/dev-server.sh [port]
# The server answers over HTTPS with a self-signed certificate for localhost, because the apps
# refuse plain-HTTP server addresses. Trust it with NODE_EXTRA_CA_CERTS=$VOWKEY_DEV_DATA/tls/cert.pem.
# VOWKEY_DEV_DATA keeps the data folder between runs; WEB_VAULT_FOLDER points at another web build.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
port="${1:-8443}"
data="${VOWKEY_DEV_DATA:-$(mktemp -d)}"
tls="$data/tls"

(cd "$root/server" && cargo build --features sqlite)

if [ ! -f "$tls/cert.pem" ]; then
  mkdir -p "$tls"
  openssl req -x509 -newkey rsa:2048 -nodes -days 30 -subj "/CN=localhost" \
    -addext "subjectAltName=DNS:localhost,IP:127.0.0.1" \
    -keyout "$tls/key.pem" -out "$tls/cert.pem" 2>/dev/null
fi

export DOMAIN="https://localhost:$port"
export ROCKET_ADDRESS=127.0.0.1
export ROCKET_PORT="$port"
export ROCKET_TLS="{certs=\"$tls/cert.pem\",key=\"$tls/key.pem\"}"
export DATA_FOLDER="$data"
export WEB_VAULT_FOLDER="${WEB_VAULT_FOLDER:-$root/clients/apps/web/build}"
export SIGNUPS_ALLOWED=true
if [ ! -f "$WEB_VAULT_FOLDER/index.html" ]; then
  echo "no web app build at $WEB_VAULT_FOLDER; serving the API only"
  export WEB_VAULT_ENABLED=false
fi

echo "vowkey-server on $DOMAIN, data in $data"
exec "$root/server/target/debug/vowkey-server"
