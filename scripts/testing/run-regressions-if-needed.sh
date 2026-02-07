#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
cd "$ROOT_DIR"

BASE_REF="${1:-}"

if ./scripts/testing/should-run-regressions.sh "$BASE_REF"; then
    if [[ "${PIWORK_FORCE_REGRESSIONS:-0}" != "1" ]] && ./scripts/testing/regression-stamp.sh matches-head; then
        head_short=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
        echo "[regressions] already passed for HEAD ${head_short}; skipping"
        exit 0
    fi

    echo "[regressions] running live regression suite..."
    ./scripts/testing/run-regressions.sh
else
    echo "[regressions] skipped"
fi
