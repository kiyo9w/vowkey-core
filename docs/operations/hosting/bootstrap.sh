#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")" && pwd)"
env_file="${VOWKEY_ENV_FILE:?set VOWKEY_ENV_FILE}"
public_key="${VOWKEY_TOKEN_PUBLIC_KEY:?set VOWKEY_TOKEN_PUBLIC_KEY}"
compose=(docker-compose --env-file "$env_file" -f "$root/compose.yml")
if [ "${VOWKEY_LOCAL:-false}" = true ]; then
  compose+=(-f "$root/compose.local.yml")
fi
if [ "${1:-up}" != up ]; then
  "${compose[@]}" "$@"
  exit
fi

"${compose[@]}" build
"${compose[@]}" up -d server
for attempt in {1..90}; do
  if "${compose[@]}" exec -T server curl --fail --silent http://127.0.0.1/alive >/dev/null; then
    break
  fi
  if [ "$attempt" = 90 ]; then
    "${compose[@]}" logs --tail=100 server >&2
    exit 1
  fi
  sleep 2
done

mkdir -p "$(dirname "$public_key")"
temporary_key="$(mktemp "${public_key}.XXXXXX")"
trap 'rm -f "$temporary_key"' EXIT
"${compose[@]}" exec -T server openssl rsa -in /data/rsa_key.pem -pubout >"$temporary_key"
chmod 644 "$temporary_key"
mv "$temporary_key" "$public_key"
"${compose[@]}" up -d
if [ "${VOWKEY_LOCAL:-false}" = true ]; then
  port="${VOWKEY_LOCAL_PORT:-8102}"
  origin="http://$VOWKEY_DOMAIN:$port"
else
  port=443
  origin="https://$VOWKEY_DOMAIN"
fi
for attempt in {1..90}; do
  if curl --fail --silent --resolve "$VOWKEY_DOMAIN:$port:127.0.0.1" "$origin/alive" >/dev/null; then
    "${compose[@]}" exec -T relay node -e \
      'fetch("http://127.0.0.1:8787/healthz").then(r=>{if(!r.ok)process.exitCode=1})'
    printf 'Stack ready at %s\n' "$origin"
    exit 0
  fi
  sleep 2
done
"${compose[@]}" logs --tail=100 proxy >&2
exit 1
