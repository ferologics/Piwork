# Testing Strategy

## Test layers

### 1) Unit + contract tests (primary gate)

- Vitest for frontend/state logic and runtime contract behavior.
- Rust unit tests for backend stores/validation.
- Regression tests must assert against a machine-readable `state_snapshot` payload (not terminal log text).
- Use `mise run test-regressions` for runtime contract regressions (live app process).
- Daily local gate: `mise run check` (fast).
- Required high-confidence gate: `mise run check-full` (fast gate + live regressions) when forcing a full run.
- Day-to-day push ergonomics: `mise run test-regressions-if-needed` to skip live regressions when non-impacting files changed.

### 2) Harness primitives (integration support)

Primitives in `mise-tasks/test-*` remain useful for fast integration probes and evidence capture, but they are **not a substitute** for automated assertions in Vitest/Rust.

Core: `test-start`, `test-stop`, `test-prompt`, `test-screenshot`, `test-dump-state`, `test-state-snapshot`
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

## Suggested git hook policy

- `mise run setup` installs hooks automatically (or run `mise run install-git-hooks` manually).
- pre-commit: `mise run check` (fast feedback)
- pre-push: `mise run test-regressions-if-needed` (runs live regressions only when integration-impacting files changed)
- override: `PIWORK_FORCE_CHECK_FULL=1 git push` for a forced full gate in pre-push
- CI (`.github/workflows/ci.yml`): `check` always; `check-full` only when integration-impacting paths changed.

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

Implemented live canaries (integration):

- `reopen-cwd.integration.test.ts`
- `folder-bind-continuity.integration.test.ts`
- `working-folder-panel-refresh.integration.test.ts`
- `runtime-mismatch-badge.integration.test.ts`

## Live integration strategy (hybrid)

- Keep **one sequential journey canary** that covers a realistic end-to-end flow (messages, models, working folder, artifacts, reopen).
- Keep **a few focused canaries** for brittle invariants so failures are easy to diagnose.
- Do not rely on a single giant scenario as the only guardrail; it is too hard to debug when it fails.

## Speed policy

- `mise run check` should stay snappy (fast lane only).
- `mise run check-full` is allowed to be slower, but should stay bounded and stable.
- Integration tests should share setup where possible and use `state_snapshot` polling instead of fixed sleeps.

## Deferred

Playwright/driver-based E2E deferred until runtime stabilizes.
