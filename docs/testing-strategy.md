# Testing Strategy

## Current priorities

1. Fast local feedback for runtime/UI regressions
2. Deterministic validation for task switching and prompt flows
3. Evidence-backed runtime claims (state + screenshot + logs)

## Test layers

### 1) Unit tests (fast)

- Vitest for frontend/state logic
- Rust unit tests for backend stores/validation
- Run via `mise run test` / `mise run check`

### 2) Harness-driven runtime checks (integration)

Primitive tasks (in `mise-tasks/`):

- `test-start`
- `test-prompt`
- `test-set-folder`
- `test-set-task`
- `test-create-task`
- `test-delete-tasks`
- `test-dump-state`
- `test-screenshot`
- `test-check-permissions`
- `test-open-preview`
- `test-stop`

Note: screenshot checks require Screen Recording permission for the terminal/app process running the harness. Blank/black captures are treated as failures. Run `mise run test-check-permissions` as a quick preflight.

Use these primitives for focused checks instead of large brittle end-to-end scripts.

Repeatable I2 scope checks are codified in:

- `./scripts/harness/path-i-lite-negative.sh`
- reference: `docs/path-i-lite-negative-suite.md`

Auth mount/profile smoke check:

- `./scripts/harness/auth-profile-mount-smoke.sh`
- reference: `docs/auth-profile-mount-smoke.md`

Both suite scripts run a screenshot-permission preflight (`mise run test-check-permissions`) before executing checks.

## Evidence rule for runtime behavior claims

Always capture all three:

1. `test-dump-state`
2. `test-screenshot <name>`
3. supporting log lines (`tmp/dev/piwork.log`, VM log)

## Active validation focus

- v2 task switching stability (`switch_task` ACK + `task_ready` flow)
- scoped folder behavior (Path I-lite)
- task resume semantics / no cross-task bleed

## Deferred

- Playwright/driver-based full E2E is deferred until runtime model stabilizes.
