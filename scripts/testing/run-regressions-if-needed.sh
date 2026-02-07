#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
cd "$ROOT_DIR"

BASE_REF="${1:-}"
if [[ -z "$BASE_REF" ]]; then
    BASE_REF='@{u}'
fi

if [[ "${PIWORK_SKIP_REGRESSIONS:-0}" == "1" ]]; then
    echo "[regressions] skipped by PIWORK_SKIP_REGRESSIONS=1"
    echo "[regressions] skipped"
    exit 0
fi

if [[ "${PIWORK_FORCE_REGRESSIONS:-0}" == "1" ]]; then
    echo "[regressions] forced by PIWORK_FORCE_REGRESSIONS=1"
else
    if ! git rev-parse --verify "$BASE_REF" >/dev/null 2>&1; then
        echo "[regressions] no upstream base reference (${BASE_REF}); running regressions"
    else
        CHANGED=$(git diff --name-only "${BASE_REF}"...HEAD)
        if [[ -z "$CHANGED" ]]; then
            echo "[regressions] no changes since ${BASE_REF}; skipping regressions"
            echo "[regressions] skipped"
            exit 0
        fi

        PATTERN='^(runtime/|src-tauri/src/|src/lib/components/layout/|src/lib/services/runtimeService\.ts$|src/lib/stores/(runtimeDebugStore|taskStore)\.ts$|src/lib/__tests__/integration/|scripts/testing/(run-regressions|run-regressions-if-needed)\.sh$|mise-tasks/runtime-build)'
        MATCHED=$(printf '%s\n' "$CHANGED" | grep -E "$PATTERN" || true)

        if [[ -z "$MATCHED" ]]; then
            echo "[regressions] no integration-impacting files changed; skipping regressions"
            echo "[regressions] skipped"
            exit 0
        fi

        echo "[regressions] integration-impacting changes detected:"
        printf '%s\n' "$MATCHED" | sed 's/^/  - /'
    fi
fi

if [[ "${PIWORK_FORCE_REGRESSIONS:-0}" != "1" ]] && ./scripts/testing/regression-stamp.sh matches-head; then
    head_short=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
    echo "[regressions] already passed for HEAD ${head_short}; skipping"
    exit 0
fi

echo "[regressions] running live regression suite..."
./scripts/testing/run-regressions.sh
