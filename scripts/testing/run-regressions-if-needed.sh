#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
cd "$ROOT_DIR"

BASE_REF="${1:-}"

if ./scripts/testing/should-run-regressions.sh "$BASE_REF"; then
    echo "[regressions] running live regression suite..."
    mise run test-regressions
else
    echo "[regressions] skipped"
fi
