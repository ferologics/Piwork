#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
cd "$ROOT_DIR"

if [[ "${PIWORK_FORCE_REGRESSIONS:-0}" == "1" ]]; then
    echo "[regressions] forced by PIWORK_FORCE_REGRESSIONS=1"
    exit 0
fi

if [[ "${PIWORK_SKIP_REGRESSIONS:-0}" == "1" ]]; then
    echo "[regressions] skipped by PIWORK_SKIP_REGRESSIONS=1"
    exit 1
fi

BASE_REF="${1:-}"
if [[ -z "$BASE_REF" ]]; then
    BASE_REF='@{u}'
fi

if ! git rev-parse --verify "$BASE_REF" >/dev/null 2>&1; then
    echo "[regressions] no upstream base reference (${BASE_REF}); running regressions"
    exit 0
fi

CHANGED=$(git diff --name-only "${BASE_REF}"...HEAD)
if [[ -z "$CHANGED" ]]; then
    echo "[regressions] no changes since ${BASE_REF}; skipping regressions"
    exit 1
fi

PATTERN='^(runtime/|src-tauri/src/|src/lib/components/layout/|src/lib/services/runtimeService\.ts$|src/lib/stores/(runtimeDebugStore|taskStore)\.ts$|src/lib/__tests__/integration/|scripts/testing/|mise-tasks/runtime-build)'

if ! printf '%s\n' "$CHANGED" | grep -Eq "$PATTERN"; then
    echo "[regressions] no integration-impacting files changed; skipping regressions"
    exit 1
fi

echo "[regressions] integration-impacting changes detected:"
printf '%s\n' "$CHANGED" | grep -E "$PATTERN" | sed 's/^/  - /'
exit 0
