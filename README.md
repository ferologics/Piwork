# Piwork

Cowork‑style, normie‑first UI on top of **pi**, built with **Tauri**.

## Status

Working prototype with VM-based sandbox. See `AGENTS.md` for architecture details.

## Stack

- Tauri 2
- SvelteKit
- pnpm
- Tailwind 4 + shadcn‑svelte
- mise (task runner)

## Development

```bash
mise run setup       # installs deps + git hooks
mise run tauri-dev
```

```bash
mise run check                    # fast local gate
mise run check-full               # forced full gate (fast + live regressions)
mise run test-regressions-if-needed # runs live regressions only if integration-impacting files changed
# pre-push skips rerun when regressions already passed on current clean HEAD
```

CI mirrors this split (`.github/workflows/ci.yml`): fast `check` always, `check-full` only when integration-impacting paths changed.

```bash
mise run test
mise run test-vite
mise run test-rust
mise run test-regressions
```

```bash
mise run install-git-hooks   # reinstall hooks manually (pre-commit/check + pre-push/conditional regressions)
# force full pre-push gate once:
PIWORK_FORCE_CHECK_FULL=1 git push
```

## AI Harness (debug/dev)

File-based harness tasks live in `mise-tasks/`:

```bash
mise run test-start
mise run test-create-task "Title" /path/to/folder
mise run test-set-task <task-id>
mise run test-send-login                 # trigger /login via UI path
mise run test-auth-list
mise run test-auth-set-key <provider> <key>
mise run test-auth-delete <provider>
mise run test-auth-import-pi
mise run test-open-preview <task-id> <relative-path>
mise run test-write-working-file <relative-path> [content]
mise run test-open-working-folder <task-id>
mise run test-dump-state
mise run test-state-snapshot
mise run test-runtime-diag         # taskd diagnostics (pending requests/history)
mise run test-screenshot name
mise run test-check-permissions   # quick preflight for screenshot visibility
mise run test-stop
```

Scope enforcement suite:

```bash
./scripts/harness/path-i-lite-negative.sh
```

### Cleanup

```bash
mise run clean        # remove build artifacts
mise run clean-deep   # remove build artifacts + node_modules
mise run reset        # clean-deep + setup
```

### Rust build cache

Rust builds use **sccache** via `.cargo/config.toml`.

## Assets

- `assets/logo.svg` is the source for app icons.
- Regenerate with `mise run icons`.

## Docs

- `AGENTS.md` - AI-focused project context and architecture
- `TODO.md` - roadmap and task tracking
- `docs/README.md` - docs index + source-of-truth pointers
- `docs/runtime-taskd-plan.md` - runtime rollout status and active execution track
- `docs/runtime-taskd-rpc-spec.md` - taskd RPC contract
- `docs/pi-integration.md` - host↔VM↔taskd integration overview
- `docs/runtime-pack.md` - runtime pack + VM boot model
- `docs/auth-flow.md` - authentication flow
- `docs/permissions-model.md` - folder access model
- `docs/task-artifact-contract.md` - working-folder immutability + outputs/uploads contract
- `docs/research/` - Cowork observations and runtime intel
