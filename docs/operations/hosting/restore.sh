#!/usr/bin/env bash
# Usage: restore.sh <archive.tar.age> <empty-data-dir> <new-push-sqlite> <identity-file>
set -euo pipefail
archive="${1:?archive}"
data="${2:?data directory}"
push="${3:?push sqlite path}"
identity="${4:?age identity file}"
if [ -e "$push" ] || [ -L "$push" ] || [ -L "$data" ]; then
  echo "Restore needs empty scratch targets" >&2
  exit 1
fi
if [ -e "$data" ]; then
  [ -d "$data" ] && [ -z "$(find "$data" -mindepth 1 -print -quit)" ] || {
    echo "Restore data directory is not empty" >&2; exit 1;
  }
fi
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
age -d -i "$identity" -o "$work/archive.tar" "$archive"
python3 - "$work/archive.tar" "$work" <<'PY'
import pathlib
import sys
import tarfile

with tarfile.open(sys.argv[1]) as archive:
    members = archive.getmembers()
    names = set()
    for member in members:
        path = pathlib.PurePosixPath(member.name)
        if path.is_absolute() or ".." in path.parts or not path.parts:
            raise ValueError("Unsafe archive path")
        allowed = (member.name in {"data", "data/db.sqlite3", "data/rsa_key.pem", "data/config.json", "push.sqlite"}
                   or path.parts[:2] in {("data", "attachments"), ("data", "sends")})
        if not allowed or not (member.isfile() or member.isdir()) or member.name in names:
            raise ValueError("Unexpected archive entry")
        names.add(member.name)
    archive.extractall(sys.argv[2], members=members, filter="data")
PY
for required in "$work/data/db.sqlite3" "$work/data/rsa_key.pem" "$work/push.sqlite"; do
  [ -f "$required" ] || { echo "Archive is incomplete" >&2; exit 1; }
done
[ "$(sqlite3 "$work/data/db.sqlite3" 'PRAGMA integrity_check;')" = ok ]
[ "$(sqlite3 "$work/push.sqlite" 'PRAGMA integrity_check;')" = ok ]
openssl rsa -in "$work/data/rsa_key.pem" -check -noout >/dev/null 2>&1
chmod 600 "$work/data/rsa_key.pem"
mkdir -p "$(dirname "$data")" "$(dirname "$push")"
if [ -d "$data" ]; then rmdir "$data"; fi
mv "$work/data" "$data"
mv "$work/push.sqlite" "$push"
printf 'Restored into %s\n' "$data"
