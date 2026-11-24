#!/usr/bin/env bash
# Build and stage the web vault used by Dockerfile.server.
set -euo pipefail

root="$(cd "$(dirname "$0")/../../.." && pwd)"
stage="${root}/docs/operations/hosting/build-vault"
out="${stage}/web-vault"
rm -rf "$stage"
mkdir -p "$stage"

env -u NODE_OPTIONS npm --prefix "${root}/clients" run build:oss:selfhost:prod --workspace @vowkey/web-vault

src="${root}/clients/apps/web/build"
if [ ! -f "${src}/index.html" ]; then
  echo "built vault missing ${src}/index.html" >&2
  exit 1
fi
cp -a "${src}" "${out}"
