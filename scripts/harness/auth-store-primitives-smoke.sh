#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
PROFILE="smoke-$(date +%s)"
AUTH_ROOT="$HOME/Library/Application Support/com.pi.work/auth"
AUTH_DIR="$AUTH_ROOT/$PROFILE"
KEY_VALUE="smoke-key-$PROFILE"

cleanup() {
    rm -rf "$AUTH_DIR"
    mise run test-stop >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "[auth-primitives] starting app"
PIWORK_RUNTIME_V2_TASKD=1 PIWORK_WORKSPACE_ROOT="$ROOT_DIR" mise run test-start >/dev/null

echo "[auth-primitives] set key in profile $PROFILE"
SET_OUTPUT=$(mise run test-auth-set-key anthropic "$KEY_VALUE" "$PROFILE")

if [[ "$SET_OUTPUT" == ERR:* ]]; then
    echo "[auth-primitives] set-key failed: $SET_OUTPUT"
    exit 1
fi

echo "[auth-primitives] verify list output"
LIST_OUTPUT=$(mise run test-auth-list "$PROFILE")
python - "$LIST_OUTPUT" <<'PY'
import json
import sys

payload = json.loads(sys.argv[1])
entries = payload.get("entries", [])
if not any(item.get("provider") == "anthropic" and item.get("entryType") == "api_key" for item in entries):
    raise SystemExit("auth list missing anthropic/api_key entry")
PY

echo "[auth-primitives] delete anthropic provider"
DELETE_OUTPUT=$(mise run test-auth-delete anthropic "$PROFILE")
if [[ "$DELETE_OUTPUT" == ERR:* ]]; then
    echo "[auth-primitives] delete failed: $DELETE_OUTPUT"
    exit 1
fi

echo "[auth-primitives] verify delete"
LIST_AFTER_DELETE=$(mise run test-auth-list "$PROFILE")
python - "$LIST_AFTER_DELETE" <<'PY'
import json
import sys

payload = json.loads(sys.argv[1])
entries = payload.get("entries", [])
if any(item.get("provider") == "anthropic" for item in entries):
    raise SystemExit("auth delete did not remove anthropic provider")
PY

if [[ -f "$HOME/.pi/agent/auth.json" ]]; then
    echo "[auth-primitives] import ~/.pi auth into profile $PROFILE"
    IMPORT_OUTPUT=$(mise run test-auth-import-pi "$PROFILE")
    if [[ "$IMPORT_OUTPUT" == ERR:* ]]; then
        echo "[auth-primitives] import failed: $IMPORT_OUTPUT"
        exit 1
    fi
fi

mise run test-dump-state >/dev/null

echo "[auth-primitives] PASS"
