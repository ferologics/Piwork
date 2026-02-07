#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
cd "$ROOT_DIR"

pnpm exec svelte-kit sync
mise run runtime-build
pnpm exec vitest run --minWorkers=1 --maxWorkers=1 \
    src/lib/__tests__/integration/runtime-steady-state.integration.test.ts \
    src/lib/__tests__/integration/journey-sequential.integration.test.ts

./scripts/testing/regression-stamp.sh write
