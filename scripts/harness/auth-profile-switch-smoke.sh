#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
APP_SUPPORT_DIR="$HOME/Library/Application Support/com.pi.work"
APP_AUTH_ROOT="$APP_SUPPORT_DIR/auth"
DEFAULT_AUTH="$APP_AUTH_ROOT/default/auth.json"
WORK_AUTH="$APP_AUTH_ROOT/work/auth.json"
QEMU_LOG="$APP_SUPPORT_DIR/vm/qemu.log"
PIWORK_LOG="$ROOT_DIR/tmp/dev/piwork.log"
SCREENSHOT_NAME="${1:-auth-profile-switch-smoke}"

DEFAULT_BACKUP=""
WORK_BACKUP=""

cleanup() {
    if [[ -n "$DEFAULT_BACKUP" && -f "$DEFAULT_BACKUP" ]]; then
        cp -f "$DEFAULT_BACKUP" "$DEFAULT_AUTH"
        rm -f "$DEFAULT_BACKUP"
    else
        rm -f "$DEFAULT_AUTH"
    fi

    if [[ -n "$WORK_BACKUP" && -f "$WORK_BACKUP" ]]; then
        cp -f "$WORK_BACKUP" "$WORK_AUTH"
        rm -f "$WORK_BACKUP"
    else
        rm -f "$WORK_AUTH"
    fi

    mise run test-stop >/dev/null 2>&1 || true
}
trap cleanup EXIT

mkdir -p "$APP_AUTH_ROOT/default" "$APP_AUTH_ROOT/work"

if [[ -f "$DEFAULT_AUTH" ]]; then
    DEFAULT_BACKUP=$(mktemp)
    cp -f "$DEFAULT_AUTH" "$DEFAULT_BACKUP"
fi

if [[ -f "$WORK_AUTH" ]]; then
    WORK_BACKUP=$(mktemp)
    cp -f "$WORK_AUTH" "$WORK_BACKUP"
fi

cat > "$DEFAULT_AUTH" <<'EOF'
{
    "anthropic": {
        "type": "api_key",
        "key": "default-profile-smoke"
    }
}
EOF

cat > "$WORK_AUTH" <<'EOF'
{
    "anthropic": {
        "type": "api_key",
        "key": "work-profile-smoke"
    }
}
EOF

echo "[auth-switch] checking screenshot permission"
if ! mise run test-check-permissions; then
    echo "[auth-switch] screenshot preflight failed"
    exit 1
fi

echo "[auth-switch] starting app"
PIWORK_RUNTIME_V2_TASKD=1 PIWORK_WORKSPACE_ROOT="$ROOT_DIR" mise run test-start >/dev/null

sleep 1
mise run test-set-auth-profile work >/dev/null

FOUND_PROFILE=0
for _ in $(seq 1 40); do
    if rg -q "Using mounted auth profile: work" "$QEMU_LOG"; then
        FOUND_PROFILE=1
        break
    fi
    sleep 0.25
done

if [[ "$FOUND_PROFILE" -ne 1 ]]; then
    echo "[auth-switch] did not observe work profile mount in qemu log"
    tail -n 80 "$QEMU_LOG" || true
    exit 1
fi

mise run test-dump-state >/dev/null

FOUND_DUMP=0
for _ in $(seq 1 30); do
    if rg -q "state: .* auth=work" "$PIWORK_LOG"; then
        FOUND_DUMP=1
        break
    fi
    sleep 0.25
done

if [[ "$FOUND_DUMP" -ne 1 ]]; then
    echo "[auth-switch] did not observe auth=work in dump-state output"
    tail -n 120 "$PIWORK_LOG" || true
    exit 1
fi

mise run test-screenshot "$SCREENSHOT_NAME" >/dev/null

echo "[auth-switch] PASS"
echo "[auth-switch] screenshot=$ROOT_DIR/tmp/dev/$SCREENSHOT_NAME.png"
echo "[auth-switch] qemu_log=$QEMU_LOG"
echo "[auth-switch] piwork_log=$PIWORK_LOG"
