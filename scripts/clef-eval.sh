#!/usr/bin/env bash
# Scores the document reader on the cases in the corpus (corpus/documents/eval/cases.json).
# Clef is asked through Jev; the key comes from VOWKEY_CLEF_KEY, or on a Mac from the keychain
# item typesafe.ai.jev. Answers are cached by request, so a second run is free.
#   scripts/clef-eval.sh [--split dev|held] [--filter text] [--no-baseline] [--offline]
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -z "${VOWKEY_CLEF_KEY:-}" ] && command -v security >/dev/null 2>&1; then
  VOWKEY_CLEF_KEY="$(security find-generic-password -a "$USER" -s typesafe.ai.jev -w 2>/dev/null || true)"
  export VOWKEY_CLEF_KEY
fi

CASES="${VOWKEY_EVAL_CASES:-../vowkey/corpus/documents/eval/cases.json}"
exec cargo run -q --manifest-path sdk/Cargo.toml -p vowkey-capture --example clef_eval -- --cases "$CASES" "$@"
