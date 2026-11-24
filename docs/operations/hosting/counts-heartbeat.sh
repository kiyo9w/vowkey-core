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
day="$(python3 -c 'from datetime import datetime, timedelta, timezone; print((datetime.now(timezone.utc) - timedelta(days=1)).date())')"
if ! "${compose[@]}" logs --no-color --since 26h server | grep -F "Daily counts completed for $day" >/dev/null; then
  printf 'Daily counts have not completed for %s\n' "$day" >&2
  exit 1
fi
curl --fail --silent --show-error --max-time 20 "${COUNTS_HEARTBEAT_URL:?set COUNTS_HEARTBEAT_URL}" >/dev/null
