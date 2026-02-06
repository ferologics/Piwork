#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
LOG_FILE="$ROOT_DIR/tmp/dev/piwork.log"

cleanup() {
    mise run test-stop >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "[auth-validation] starting app"
PIWORK_RUNTIME_V2_TASKD=1 PIWORK_WORKSPACE_ROOT="$ROOT_DIR" mise run test-start >/dev/null

echo "[auth-validation] invalid profile should be rejected by auth primitives"
set +e
INVALID_OUTPUT=$(mise run test-auth-list "../evil profile" 2>&1)
INVALID_STATUS=$?
set -e

if [[ "$INVALID_STATUS" -eq 0 ]]; then
    echo "[auth-validation] expected failure for invalid profile, but command succeeded"
    echo "$INVALID_OUTPUT"
    exit 1
fi

if ! grep -q "Invalid auth profile" <<<"$INVALID_OUTPUT"; then
    echo "[auth-validation] missing expected invalid-profile error"
    echo "$INVALID_OUTPUT"
    exit 1
fi

echo "[auth-validation] invalid profile through test-set-auth-profile should normalize to default"
mise run test-set-auth-profile "../evil profile" >/dev/null
mise run test-dump-state >/dev/null

FOUND_DEFAULT=0
for _ in $(seq 1 20); do
    if rg -q "state: .* auth=default" "$LOG_FILE"; then
        FOUND_DEFAULT=1
        break
    fi
    sleep 0.25
done

if [[ "$FOUND_DEFAULT" -ne 1 ]]; then
    echo "[auth-validation] did not observe auth=default in dump-state"
    tail -n 80 "$LOG_FILE" || true
    exit 1
fi

echo "[auth-validation] PASS"
