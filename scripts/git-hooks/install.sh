#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)

if ! command -v git >/dev/null 2>&1; then
    echo "[hooks] git is not available; skipping hook install."
    exit 0
fi

HOOKS_DIR=$(git -C "$ROOT_DIR" rev-parse --git-path hooks 2>/dev/null || true)

if [[ -z "$HOOKS_DIR" ]]; then
    echo "[hooks] Not a git checkout; skipping hook install."
    exit 0
fi

if [[ "$HOOKS_DIR" != /* ]]; then
    HOOKS_DIR="$ROOT_DIR/$HOOKS_DIR"
fi

mkdir -p "$HOOKS_DIR"

install -m 0755 "$ROOT_DIR/scripts/git-hooks/pre-commit" "$HOOKS_DIR/pre-commit"
install -m 0755 "$ROOT_DIR/scripts/git-hooks/pre-push" "$HOOKS_DIR/pre-push"

echo "[hooks] Installed pre-commit and pre-push hooks to $HOOKS_DIR"
