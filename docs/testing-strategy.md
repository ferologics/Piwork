# Testing Strategy

## Test layers

### 1) Unit tests

- Vitest for frontend/state logic
- Rust unit tests for backend stores/validation
- Run via `mise run check`

### 2) Harness primitives (integration)

Primitives in `mise-tasks/test-*`. Compose ad-hoc — don't write monolithic E2E scripts.

Core: `test-start`, `test-stop`, `test-prompt`, `test-screenshot`, `test-dump-state`
Tasks: `test-create-task`, `test-delete-tasks`, `test-set-task`
Folders: `test-set-folder`
Auth: `test-auth-list`, `test-auth-set-key`, `test-auth-delete`, `test-auth-import-pi`, `test-set-auth-profile`, `test-send-login`
Preview: `test-open-preview`
Preflight: `test-check-permissions` (screenshot permission)

Screenshot checks require Screen Recording permission. Blank/black captures fail.

### 3) Scope enforcement suite

`scripts/harness/path-i-lite-negative.sh` — traversal/symlink/cross-task scope checks.
See `docs/path-i-lite-negative-suite.md`.

## Evidence rule

For any runtime behavior claim, capture all three:

1. `test-dump-state`
2. `test-screenshot <name>`
3. Supporting log lines (`tmp/dev/piwork.log`, VM log)

## Deferred

Playwright/driver-based E2E deferred until runtime stabilizes.
