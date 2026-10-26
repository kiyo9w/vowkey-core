#!/usr/bin/env bash
# Runs the tests of each component on this machine.
#   scripts/check.sh            every component
#   scripts/check.sh sdk mcp    the named components
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"

# The Node clients are tested on the Node major that clients/.nvmrc names; Homebrew's node@<major>
# provides it on this machine.
node_major="$(sed 's/^v//; s/\..*//' "$root/clients/.nvmrc")"
node_home="$(brew --prefix "node@$node_major" 2>/dev/null || true)"
[ -d "$node_home/bin" ] && export PATH="$node_home/bin:$PATH"

check_sdk() {
  (cd "$root/sdk" && cargo test --workspace --exclude vowkey-wasm-internal --exclude memory-testing --no-fail-fast)
}

check_server() {
  (cd "$root/server" && cargo test --workspace --features sqlite)
}

check_mcp() {
  (cd "$root/mcp" && npm ci --no-audit --no-fund && npm run build && npm test)
}

check_wasm() {
  (cd "$root/sdk/crates/vowkey-wasm-internal" && ./build.sh)
}

check_clients() {
  (cd "$root/clients" && npm install --ignore-scripts --no-audit --no-fund && npx jest --ci --coverage=false --silent)
}

build_cli() {
  (cd "$root/clients" && npm run build:oss --workspace @vowkey/cli)
}

check_e2e-cli() {
  build_cli
  "$root/scripts/e2e-cli.sh"
}

check_e2e-desktop() {
  (cd "$root/clients/apps/desktop" && npm run build-native && npm run build:dev)
  "$root/scripts/e2e-desktop.sh"
}

check_e2e-web() {
  build_cli
  (cd "$root/clients" && npm run build:oss:selfhost:prod --workspace @vowkey/web-vault)
  "$root/scripts/e2e-web.sh"
}

check_e2e-fill() {
  build_cli
  (cd "$root/clients" && npm run build:prod:chrome --workspace @vowkey/browser)
  "$root/scripts/e2e-fill.sh"
}

components=("$@")
if [ ${#components[@]} -eq 0 ]; then
  components=(sdk server mcp wasm clients e2e-cli e2e-desktop e2e-web e2e-fill)
fi

for c in "${components[@]}"; do
  echo "== $c"
  "check_$c"
done
echo "== all checks passed"
