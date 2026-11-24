#!/usr/bin/env bash
set -euo pipefail
env_file="${VOWKEY_ENV_FILE:?set VOWKEY_ENV_FILE}"
set -a
# shellcheck disable=SC1090
. "$env_file"
set +a
root="$(cd "$(dirname "$0")" && pwd)"
compose=(docker-compose --env-file "$env_file" -f "$root/compose.yml")
if [ "${VOWKEY_LOCAL:-false}" = true ]; then compose+=(-f "$root/compose.local.yml"); fi
stage="$(mktemp -d)"
restart=false
finish() {
  local result=$?
  if [ "$restart" = true ]; then
    "${compose[@]}" start server push || result=1
  fi
  rm -rf "$stage"
  return "$result"
}
trap finish EXIT

# A short write pause keeps the database and attachment bytes at one point in time.
restart=true
"${compose[@]}" stop server push
mkdir -p "$stage/data"
"${compose[@]}" cp server:/data/. "$stage/data"
"${compose[@]}" cp push:/var/lib/vowkey/push.sqlite "$stage/push.sqlite"
"${compose[@]}" start server push
restart=false
archive="$("$root/backup.sh" "$stage/data" "$stage/push.sqlite" "$stage")"
aws s3 cp "$archive" "s3://${BACKUP_S3_BUCKET:?set BACKUP_S3_BUCKET}/$(basename "$archive")" \
  --endpoint-url "${BACKUP_S3_ENDPOINT:?set BACKUP_S3_ENDPOINT}"
if [ -n "${BETTERSTACK_HEARTBEAT_URL:-}" ]; then
  curl --fail --silent --show-error --max-time 20 "$BETTERSTACK_HEARTBEAT_URL" >/dev/null
fi
