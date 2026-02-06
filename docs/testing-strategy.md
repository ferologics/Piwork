# Testing Strategy

## Test layers

### 1) Unit + contract tests (primary gate)

- Vitest for frontend/state logic and runtime contract behavior.
- Rust unit tests for backend stores/validation.
- Regression tests must assert against a machine-readable `state_snapshot` payload (not terminal log text).
- These are the **primary merge gate** and should run under `mise run check`.

### 2) Harness primitives (integration support)

Primitives in `mise-tasks/test-*` remain useful for fast integration probes and evidence capture, but they are **not a substitute** for automated assertions in Vitest/Rust.

Core: `test-start`, `test-stop`, `test-prompt`, `test-screenshot`, `test-dump-state`
Tasks: `test-create-task`, `test-delete-tasks`, `test-set-task`
Folders: `test-set-folder` (one-time bind; existing bound task rejects changes)
Auth: `test-auth-list`, `test-auth-set-key`, `test-auth-delete`, `test-auth-import-pi`, `test-set-auth-profile`, `test-send-login`
Preview: `test-open-preview`
Preflight: `test-check-permissions` (screenshot permission)

Screenshot checks require Screen Recording permission. Blank/black captures fail.

### 3) Scope enforcement suite (supplemental)

`scripts/harness/path-i-lite-negative.sh` checks traversal/symlink/cross-task scope behavior.
See `docs/path-i-lite-negative-suite.md`.

This suite is currently supplemental smoke coverage. Equivalent contract checks should be migrated into automated test code over time.

## Evidence rule

For any runtime behavior claim, capture all three:

1. `test-dump-state`
2. `test-screenshot <name>`
3. Supporting log lines (`tmp/dev/piwork.log`, VM log)

## Hard guarantees (P0 contracts)

The regression gate should make these guarantees explicit:

1. **Folder bind continuity**
   - Binding first working folder on an existing task must not reset conversation/UI state.
2. **Reopen cwd correctness**
   - Reopening a folder-bound task must converge to `/mnt/workdir...` cwd (not stuck in `/mnt/taskstate/<id>/outputs`).
3. **Working-folder panel freshness**
   - Working-folder file listing must refresh when `workingFolder` changes on the same task id.
4. **Runtime mismatch badge semantics**
   - Badge only appears for real mismatches, not transient boot/reconfigure or legacy sentinel state.

## Deferred

Playwright/driver-based E2E deferred until runtime stabilizes.
