#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
LOG_FILE="$ROOT_DIR/tmp/dev/piwork.log"
SCREENSHOT_NAME="${1:-path-i-lite-negative-suite}"
SUFFIX=$(date +%s)

WORKSPACE_ROOT="$ROOT_DIR/tmp/path-i-lite/workspace-$SUFFIX"
TASK_A_DIR="$WORKSPACE_ROOT/task-a"
TASK_B_DIR="$WORKSPACE_ROOT/task-b"

cleanup() {
    mise run test-stop >/dev/null 2>&1 || true
}
trap cleanup EXIT

mkdir -p "$TASK_A_DIR" "$TASK_B_DIR"
printf "alpha-secret-%s\n" "$SUFFIX" > "$TASK_A_DIR/secret-a.txt"
printf "beta-note-%s\n" "$SUFFIX" > "$TASK_B_DIR/public-b.txt"
ln -sfn ../task-a/secret-a.txt "$TASK_B_DIR/link-to-a.txt"

echo "[path-i-lite] checking screenshot permission"
if ! mise run test-check-permissions; then
    echo "[path-i-lite] screenshot preflight failed"
    exit 1
fi

echo "[path-i-lite] starting app with scoped workspace root"
PIWORK_WORKSPACE_ROOT="$WORKSPACE_ROOT" mise run test-start >/dev/null

mise run test-delete-tasks >/dev/null
sleep 1

TITLE_A="I2 Task A $SUFFIX"
TITLE_B="I2 Task B $SUFFIX"

mise run test-create-task "$TITLE_A" "$TASK_A_DIR" >/dev/null
sleep 1
mise run test-create-task "$TITLE_B" "$TASK_B_DIR" >/dev/null
sleep 1

TASKS_DIR="$HOME/Library/Application Support/com.pi.work/tasks"

TASK_A_ID=$(python - "$TASKS_DIR" "$TITLE_A" <<'PY'
import json
import pathlib
import sys

root = pathlib.Path(sys.argv[1])
title = sys.argv[2]
for task_file in root.glob("*/task.json"):
    try:
        data = json.loads(task_file.read_text())
    except Exception:
        continue
    if data.get("title") == title:
        print(data.get("id", ""))
        break
PY
)

TASK_B_ID=$(python - "$TASKS_DIR" "$TITLE_B" <<'PY'
import json
import pathlib
import sys

root = pathlib.Path(sys.argv[1])
title = sys.argv[2]
for task_file in root.glob("*/task.json"):
    try:
        data = json.loads(task_file.read_text())
    except Exception:
        continue
    if data.get("title") == title:
        print(data.get("id", ""))
        break
PY
)

if [[ -z "$TASK_A_ID" || -z "$TASK_B_ID" ]]; then
    echo "[path-i-lite] failed to resolve task ids"
    exit 1
fi

mise run test-set-task "$TASK_B_ID" >/dev/null
sleep 1

echo "[path-i-lite] check 1/4: traversal read blocked"
TRAVERSAL_RESULT=$(printf '{"cmd":"preview_read","taskId":"%s","relativePath":"../task-a/secret-a.txt"}\n' "$TASK_B_ID" | nc -w 2 localhost 19385)
if [[ "$TRAVERSAL_RESULT" != *"ERR: Invalid relative path component"* && "$TRAVERSAL_RESULT" != *"ERR: relativePath must not traverse parent directories"* ]]; then
    echo "[path-i-lite] unexpected traversal result: $TRAVERSAL_RESULT"
    exit 1
fi

echo "[path-i-lite] check 2/4: symlink read blocked"
SYMLINK_RESULT=$(printf '{"cmd":"preview_read","taskId":"%s","relativePath":"link-to-a.txt"}\n' "$TASK_B_ID" | nc -w 2 localhost 19385)
if [[ "$SYMLINK_RESULT" != *"ERR: Symlink previews are not allowed"* ]]; then
    echo "[path-i-lite] unexpected symlink result: $SYMLINK_RESULT"
    exit 1
fi

echo "[path-i-lite] check 3/4: direct task file read still works"
OWN_RESULT=$(printf '{"cmd":"preview_read","taskId":"%s","relativePath":"public-b.txt"}\n' "$TASK_B_ID" | nc -w 2 localhost 19385)
if [[ "$OWN_RESULT" != *"beta-note-$SUFFIX"* ]]; then
    echo "[path-i-lite] failed own file read check"
    exit 1
fi

echo "[path-i-lite] check 4/4: guest rejects workingFolderRelative escape"
RPC_REQ_ID="path_i_lite_escape_$SUFFIX"
printf '{"id":"%s","type":"create_or_open_task","payload":{"taskId":"bad-scope-%s","provider":"anthropic","model":"claude-opus-4-5","thinkingLevel":"high","workingFolderRelative":"../escape"}}\n' "$RPC_REQ_ID" "$SUFFIX" | nc -w 2 localhost 19385 >/dev/null

ESCAPE_BLOCKED=0
for _ in $(seq 1 20); do
    if rg -q "$RPC_REQ_ID" "$LOG_FILE" && rg -q "$RPC_REQ_ID.*WORKSPACE_POLICY_VIOLATION" "$LOG_FILE"; then
        ESCAPE_BLOCKED=1
        break
    fi
    sleep 0.5
done

if [[ "$ESCAPE_BLOCKED" -ne 1 ]]; then
    echo "[path-i-lite] missing WORKSPACE_POLICY_VIOLATION evidence for $RPC_REQ_ID"
    exit 1
fi

mise run test-open-preview "$TASK_B_ID" "public-b.txt" >/dev/null
sleep 1
mise run test-dump-state >/dev/null
mise run test-screenshot "$SCREENSHOT_NAME" >/dev/null

echo "[path-i-lite] PASS"
echo "[path-i-lite] task_a=$TASK_A_ID task_b=$TASK_B_ID"
echo "[path-i-lite] screenshot=$ROOT_DIR/tmp/dev/$SCREENSHOT_NAME.png"
echo "[path-i-lite] log=$LOG_FILE"
