#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
cd "$ROOT_DIR"

runtime_dir() {
    if [[ "$(uname -s)" == "Darwin" ]]; then
        printf '%s\n' "$HOME/Library/Application Support/com.pi.work/runtime"
    else
        printf '%s\n' "${XDG_DATA_HOME:-$HOME/.local/share}/piwork/runtime"
    fi
}

runtime_pack_is_ready() {
    local dir="$1"

    [[ -f "$dir/manifest.json" ]] \
        && [[ -f "$dir/vmlinuz-virt" ]] \
        && [[ -f "$dir/initramfs-virt-fast" ]]
}

ensure_runtime_pack() {
    local dir
    dir=$(runtime_dir)

    if [[ "${PIWORK_RUNTIME_CACHE_HIT:-}" == "true" ]] && runtime_pack_is_ready "$dir"; then
        echo "[runtime-build] cache hit and runtime pack is ready at $dir; skipping rebuild"
        return
    fi

    if [[ "${PIWORK_RUNTIME_CACHE_HIT:-}" == "true" ]]; then
        echo "[runtime-build] cache hit reported, but runtime pack is missing/incomplete at $dir; rebuilding"
    else
        echo "[runtime-build] cache miss; rebuilding runtime pack"
    fi

    mise run runtime-build
}

pnpm exec svelte-kit sync
ensure_runtime_pack

vitest_args=(--minWorkers=1 --maxWorkers=1)
if [[ "${CI:-}" == "true" ]]; then
    vitest_args+=(--bail=1)
fi

pnpm exec vitest run "${vitest_args[@]}" \
    src/lib/__tests__/integration/runtime-steady-state.integration.test.ts \
    src/lib/__tests__/integration/journey-sequential.integration.test.ts

./scripts/testing/regression-stamp.sh write
