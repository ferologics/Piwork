#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
HOOKS_DIR="$ROOT_DIR/.git/hooks"

if [[ ! -d "$HOOKS_DIR" ]]; then
    echo "[hooks] .git/hooks not found. Run from a git worktree."
    exit 1
fi

install -m 0755 "$ROOT_DIR/scripts/git-hooks/pre-commit" "$HOOKS_DIR/pre-commit"
install -m 0755 "$ROOT_DIR/scripts/git-hooks/pre-push" "$HOOKS_DIR/pre-push"

echo "[hooks] Installed pre-commit and pre-push hooks."
