#!/usr/bin/env bash
# Scores the document reader on the cases in the corpus (corpus/documents/eval/cases.json).
# Decision is asked through Jev; the key comes from VOWKEY_DECISION_KEY, or on a Mac from the keychain
# item typesafe.ai.jev. Answers are cached by request, so a second run is free.
#   scripts/decision-eval.sh [--split dev|held] [--filter text] [--no-baseline] [--offline]
set -euo pipefail
cd "$(dirname "$0")/.."

# A model on this computer needs no key, and Jev's is not sent to it.
case "${VOWKEY_DECISION_URL:-}" in
  http://127.0.0.1*|http://localhost*) ;;
  *)
if [ -z "${VOWKEY_DECISION_KEY:-}" ] && command -v security >/dev/null 2>&1; then
  VOWKEY_DECISION_KEY="$(security find-generic-password -a "$USER" -s typesafe.ai.jev -w 2>/dev/null || true)"
  export VOWKEY_DECISION_KEY
fi
    ;;
esac

CASES="${VOWKEY_EVAL_CASES:-../vowkey/corpus/documents/eval/cases.json}"
exec cargo run -q --manifest-path sdk/Cargo.toml -p vowkey-capture --example decision_eval -- --cases "$CASES" "$@"
