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
mise run setup
mise run tauri-dev
```

```bash
mise run check
```

```bash
mise run test
```

```bash
mise run test-vite
mise run test-rust
```

## AI Harness (debug/dev)

File-based harness tasks live in `mise-tasks/`:

```bash
mise run test-start
mise run test-create-task "Title" /path/to/folder
mise run test-set-task <task-id>
mise run test-set-auth-profile <profile>
mise run test-auth-list [profile]
mise run test-auth-set-key <provider> <key> [profile]
mise run test-auth-import-pi [profile]
mise run test-open-preview <task-id> <relative-path>
mise run test-dump-state
mise run test-screenshot name
mise run test-check-permissions   # quick preflight for screenshot visibility
mise run test-stop
```

Repeatable harness checks:

```bash
./scripts/harness/path-i-lite-negative.sh
./scripts/harness/auth-profile-mount-smoke.sh
./scripts/harness/auth-profile-switch-smoke.sh
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
- `docs/runtime-v2-taskd-plan.md` - runtime rollout status and active execution track
- `docs/runtime-v2-taskd-rpc-spec.md` - v2 taskd RPC contract
- `docs/pi-integration.md` - host↔VM↔taskd integration overview
- `docs/runtime-pack.md` - runtime pack + VM boot model
- `docs/auth-flow.md` - authentication flow
- `docs/mvp-definition.md` - locked MVP scope decisions
- `docs/permissions-model.md` - folder access model
- `docs/research/` - Cowork observations and runtime intel
