#!/usr/bin/env bash
# Run against stopped services or a quiescent copy made by backup-cron.sh.
# Usage: backup.sh <data-dir> <push-sqlite> <out-dir>
set -euo pipefail
data="${1:?data directory}"
push="${2:?push sqlite path}"
out="${3:?output directory}"
recipient="${BACKUP_AGE_RECIPIENT:?set BACKUP_AGE_RECIPIENT to an age recipient file}"
for required in "$data/db.sqlite3" "$data/rsa_key.pem" "$push" "$recipient"; do
  [ -r "$required" ] || { printf 'Missing backup input: %s\n' "$required" >&2; exit 1; }
done
mkdir -p "$out"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
mkdir -p "$work/data/attachments" "$work/data/sends"
sqlite3 "$data/db.sqlite3" ".backup '$work/data/db.sqlite3'"
sqlite3 "$push" ".backup '$work/push.sqlite'"
sqlite3 "$work/data/db.sqlite3" 'PRAGMA journal_mode=DELETE;' >/dev/null
sqlite3 "$work/push.sqlite" 'PRAGMA journal_mode=DELETE;' >/dev/null
[ "$(sqlite3 "$work/data/db.sqlite3" 'PRAGMA integrity_check;')" = ok ]
[ "$(sqlite3 "$work/push.sqlite" 'PRAGMA integrity_check;')" = ok ]
for directory in attachments sends; do
  if [ -d "$data/$directory" ]; then
    cp -a "$data/$directory/." "$work/data/$directory/"
  fi
done
cp "$data/rsa_key.pem" "$work/data/rsa_key.pem"
chmod 600 "$work/data/rsa_key.pem"
if [ -f "$data/config.json" ]; then cp "$data/config.json" "$work/data/config.json"; fi
archive="$out/vowkey-$(date -u +%Y%m%dT%H%M%SZ)-${RANDOM}.tar.age"
members=(data/db.sqlite3 data/rsa_key.pem data/attachments data/sends push.sqlite)
if [ -f "$work/data/config.json" ]; then members+=(data/config.json); fi
COPYFILE_DISABLE=1 tar -C "$work" -cf - "${members[@]}" | age -R "$recipient" -o "$work/archive.age"
mv "$work/archive.age" "$archive"
printf '%s\n' "$archive"
