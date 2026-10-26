#!/usr/bin/env bash
# Runs the tests of each component on this machine.
#   scripts/check.sh            every component
#   scripts/check.sh sdk mcp    the named components
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"

check_sdk() {
  (cd "$root/sdk" && cargo test --workspace --exclude vowkey-wasm-internal --exclude memory-testing --no-fail-fast)
}

check_server() {
  (cd "$root/server" && cargo test --workspace --features sqlite)
}

check_mcp() {
  (cd "$root/mcp" && npm ci --no-audit --no-fund && npm run build && npm test)
}

components=("$@")
if [ ${#components[@]} -eq 0 ]; then
  components=(sdk server mcp)
fi

for c in "${components[@]}"; do
  echo "== $c"
  "check_$c"
done
echo "== all checks passed"
