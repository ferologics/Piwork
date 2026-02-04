#!/usr/bin/env bash
set -euo pipefail

if [[ -n "${PIWORK_RUNTIME_DIR:-}" ]]; then
    echo "$PIWORK_RUNTIME_DIR"
    exit 0
fi

if [[ "$(uname -s)" == "Darwin" ]]; then
    echo "$HOME/Library/Application Support/com.pi.work/runtime"
    exit 0
fi

if [[ -n "${XDG_DATA_HOME:-}" ]]; then
    echo "$XDG_DATA_HOME/piwork/runtime"
    exit 0
fi

echo "$HOME/.local/share/piwork/runtime"
