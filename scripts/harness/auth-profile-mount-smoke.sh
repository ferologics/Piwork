#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
APP_SUPPORT_DIR="$HOME/Library/Application Support/com.pi.work"
APP_AUTH_DIR="$APP_SUPPORT_DIR/auth/default"
APP_AUTH_FILE="$APP_AUTH_DIR/auth.json"
QEMU_LOG="$APP_SUPPORT_DIR/vm/qemu.log"
SCREENSHOT_NAME="${1:-auth-profile-mount-smoke}"
SENTINEL="piwork-auth-smoke-$(date +%s)"
BACKUP_FILE=""

cleanup() {
    if [[ -n "$BACKUP_FILE" && -f "$BACKUP_FILE" ]]; then
        cp -f "$BACKUP_FILE" "$APP_AUTH_FILE"
        rm -f "$BACKUP_FILE"
    else
        rm -f "$APP_AUTH_FILE"
    fi

    mise run test-stop >/dev/null 2>&1 || true
}
trap cleanup EXIT

mkdir -p "$APP_AUTH_DIR"

if [[ -f "$APP_AUTH_FILE" ]]; then
    BACKUP_FILE=$(mktemp)
    cp -f "$APP_AUTH_FILE" "$BACKUP_FILE"
fi

cat > "$APP_AUTH_FILE" <<EOF
{
    "anthropic": {
        "type": "api_key",
        "key": "$SENTINEL"
    }
}
EOF

echo "[auth-smoke] checking screenshot permission"
if ! mise run test-check-permissions; then
    echo "[auth-smoke] screenshot preflight failed"
    exit 1
fi

echo "[auth-smoke] starting app"
PIWORK_RUNTIME_V2_TASKD=1 PIWORK_WORKSPACE_ROOT="$ROOT_DIR" mise run test-start >/dev/null

qemu_log_contains() {
    local pattern="$1"

    if [[ ! -f "$QEMU_LOG" ]]; then
        return 1
    fi

    tr -d '\000' < "$QEMU_LOG" | rg -q "$pattern"
}

FOUND_MOUNT=0
FOUND_PROFILE=0

for _ in $(seq 1 40); do
    if qemu_log_contains "Mounted auth state at /mnt/authstate"; then
        FOUND_MOUNT=1
    fi

    if qemu_log_contains "Using mounted auth profile: default"; then
        FOUND_PROFILE=1
    fi

    if [[ "$FOUND_MOUNT" -eq 1 && "$FOUND_PROFILE" -eq 1 ]]; then
        break
    fi

    sleep 0.25
done

if [[ "$FOUND_MOUNT" -ne 1 || "$FOUND_PROFILE" -ne 1 ]]; then
    echo "[auth-smoke] expected auth mount/profile lines missing"
    echo "--- qemu.log (sanitized) ---"
    if [[ -f "$QEMU_LOG" ]]; then
        tr -d '\000' < "$QEMU_LOG" | tail -n 80 || true
    fi
    exit 1
fi

mise run test-dump-state >/dev/null

SHOT_OK=0
for _ in $(seq 1 4); do
    if mise run test-screenshot "$SCREENSHOT_NAME" >/dev/null 2>&1; then
        SHOT_OK=1
        break
    fi
    sleep 0.5
done

if [[ "$SHOT_OK" -ne 1 ]]; then
    echo "[auth-smoke] failed to capture screenshot"
    exit 1
fi

echo "[auth-smoke] PASS"
echo "[auth-smoke] screenshot=$ROOT_DIR/tmp/dev/$SCREENSHOT_NAME.png"
echo "[auth-smoke] qemu_log=$QEMU_LOG"
