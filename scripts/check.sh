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

# PDF forms are filled with Python; the tests run it from an environment of its own under sdk/target.
pdf_python() {
  local env="$root/sdk/target/pdf-tools"
  if [ ! -x "$env/bin/python" ]; then
    python3 -m venv "$env" && "$env/bin/python" -m pip install --quiet pypdf cryptography
  fi
  echo "$env/bin/python"
}

check_sdk() {
  (cd "$root/sdk" && VOWKEY_PYTHON="$(pdf_python)" cargo test --workspace --exclude vowkey-wasm-internal --exclude memory-testing --no-fail-fast)
}

check_server() {
  (cd "$root/server" && cargo test --workspace --features sqlite)
}

check_mcp() {
  (cd "$root/mcp" && npm ci --no-audit --no-fund && npm run build && npm test)
}

check_relay() {
  (cd "$root/relay" && npm test)
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

check_e2e-relay() {
  "$root/scripts/e2e-relay.sh"
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

check_e2e-loop() {
  build_cli
  (cd "$root/clients/apps/desktop" && npm run build-native && npm run build:dev)
  (cd "$root/clients" && npm run build:prod:chrome --workspace @vowkey/browser && npm run build:oss:selfhost:prod --workspace @vowkey/web-vault)
  "$root/scripts/e2e-loop.sh"
}

# The two scorers measure the matcher and always exit 0, so they run on request and not by default:
#   scripts/check.sh score-chromium score-corpus
check_score-chromium() {
  python3 "$root/scripts/score-chromium.py"
}

check_score-corpus() {
  python3 "$root/scripts/score-corpus.py"
}

components=("$@")
if [ ${#components[@]} -eq 0 ]; then
  components=(sdk server mcp relay wasm clients e2e-cli e2e-relay e2e-desktop e2e-web e2e-fill e2e-loop)
fi

for c in "${components[@]}"; do
  echo "== $c"
  "check_$c"
done
echo "== all checks passed"
