#!/usr/bin/env bash
# Brings up the local office sign-in stack and runs scripts/e2e-office.mjs against it:
#   - Keycloak 26.8.1 with two synthetic realms from docs/operations/keycloak:
#     "workforce" is the real SAML identity provider, "office" brokers to it and serves
#     Vowkey over OIDC as client "vowkey"
#   - a fresh vowkey-server (sqlite) with SSO pointed at the office realm
#
#   KEYCLOAK_PORT=8088 scripts/e2e-office.sh
#
# Everything is synthetic and local: admin/admin for Keycloak, development-only client
# secrets, a self-signed certificate for the server. No production account, DNS or key.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
work="$(mktemp -d)"
kc_port="${KEYCLOAK_PORT:-8088}"
kc_project="vowkey-office-e2e"
kc_url="http://localhost:$kc_port"
admin_token="$(openssl rand -hex 24)"
server_pid=""
kc_started=false

cleanup() {
  local result=$?
  if [ -n "$server_pid" ]; then kill "$server_pid" 2>/dev/null || true; fi
  if [ "$kc_started" = true ]; then
    (cd "$root/docs/operations" && KEYCLOAK_PORT="$kc_port" docker-compose -f keycloak-compose.yml -p "$kc_project" down >/dev/null 2>&1) || true
  fi
  if [ "$result" -eq 0 ]; then rm -rf "$work"; else printf 'Office e2e artifacts: %s\n' "$work" >&2; fi
  return "$result"
}
trap cleanup EXIT

# Keycloak, importing both realm files. The realm files use ${KEYCLOAK_URL}, which the
# compose file sets to the published URL, so any KEYCLOAK_PORT works.
source "$root/scripts/lib/test-server.sh"
# The SSO callback page is part of the built web vault; serve it when the vault was built.
if [ -f "$root/clients/apps/web/build/index.html" ]; then
  start_test_server "$work" "$root/clients/apps/web/build"
else
  start_test_server "$work"
fi
server_pid="$TEST_SERVER_PID"

export VOWKEY_SERVER_URL="$TEST_SERVER_URL"
(cd "$root/docs/operations" && KEYCLOAK_PORT="$kc_port" VOWKEY_SERVER_URL="$TEST_SERVER_URL" docker-compose -f keycloak-compose.yml -p "$kc_project" up -d >/dev/null)
kc_started=true
for _ in $(seq 1 60); do
  if curl -sf -m 3 "$kc_url/realms/office/.well-known/openid-configuration" >/dev/null; then break; fi
  sleep 2
done
curl -sf -m 3 "$kc_url/realms/office/.well-known/openid-configuration" >/dev/null
curl -sf -m 3 "$kc_url/realms/workforce/protocol/saml/descriptor" >/dev/null

# The server. kc_idp_hint sends the office realm straight to its SAML identity provider, the
# way an office with a single directory does; the harness drives the whole chain over HTTP.
export DATABASE_URL="sqlite://$work/office.sqlite3"
export ADMIN_TOKEN="$admin_token"
export SSO_ENABLED=true
export SSO_AUTHORITY="$kc_url/realms/office"
export SSO_CLIENT_ID=vowkey
export SSO_CLIENT_SECRET=development-only
export SSO_SCOPES="openid email profile"
export SSO_AUTHORIZE_EXTRA_PARAMS="kc_idp_hint=workforce"
export SSO_SIGNUPS_ALLOWED=true
export SSO_ALLOW_UNKNOWN_EMAIL_VERIFICATION=true
export ORG_GROUPS_ENABLED=true
source "$root/scripts/lib/test-server.sh"
# The SSO callback page is part of the built web vault; serve it when the vault was built.
if [ -f "$root/clients/apps/web/build/index.html" ]; then
  start_test_server "$work" "$root/clients/apps/web/build"
else
  start_test_server "$work"
fi
server_pid="$TEST_SERVER_PID"

# Node needs its default flags for fetch; the harness unsets NODE_OPTIONS itself if needed.
env -u NODE_OPTIONS node "$root/scripts/e2e-office.mjs" "$TEST_SERVER_URL" "$kc_url" "$work" "$admin_token"
