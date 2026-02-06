# AGENTS.md — Piwork

## Project Goal

Cowork-style UI on top of **pi** using **Tauri**. File-scoped tasks, sandboxed VM execution.

## Stack

- **Tauri 2** + **SvelteKit** + **pnpm**
- **Tailwind 4 + shadcn-svelte**
- **Vitest** (unit), Playwright deferred

## Commands

```bash
mise run check              # format + lint + compile + test
mise run tauri-dev          # run app
mise run runtime-build      # build VM runtime pack
mise run runtime-build-auth # rebuild with auth baked in
mise run runtime-clean      # clean runtime artifacts
```

## Architecture

### How it works

1. **QEMU VM** boots Alpine Linux (~1s) with kernel + initramfs
2. **Init script** (`runtime/init.sh`) mounts 9p shares, starts taskd
3. **taskd** (`runtime/taskd.js`) listens on TCP 19384, spawns one pi process per task
4. **Tauri host** connects to taskd via port-forwarded TCP, sends RPC commands
5. **Frontend** (`runtimeService.ts`) orchestrates VM lifecycle and task switching

### Key files

| File                                        | What                                                           |
| ------------------------------------------- | -------------------------------------------------------------- |
| `mise-tasks/runtime-build`                  | Downloads Alpine + Node.js, builds initramfs, installs runtime |
| `runtime/init.sh`                           | VM init script (mounts, networking, starts taskd)              |
| `runtime/taskd.js`                          | Guest process supervisor — per-task pi processes, RPC routing  |
| `src-tauri/src/vm.rs`                       | QEMU process management (spawn, ready detection, stop)         |
| `src-tauri/src/lib.rs`                      | Tauri commands (VM, tasks, auth, preview, test server)         |
| `src/lib/services/runtimeService.ts`        | Frontend runtime orchestration                                 |
| `src/lib/components/layout/MainView.svelte` | Main UI component                                              |

### 9p mounts (host → VM)

| Mount     | Guest path       | Purpose                |
| --------- | ---------------- | ---------------------- |
| workdir   | `/mnt/workdir`   | User's working folder  |
| taskstate | `/mnt/taskstate` | Per-task session files |
| authstate | `/mnt/authstate` | Host auth profiles     |

### Auth (current state)

Working: bake credentials at build time, or write to `app_data/auth/<profile>/auth.json` (mounted into VM).
Aspirational: OAuth `/login` flow through VM — unclear if it works through NAT.
Settings UI: exists but is overbuilt (multi-profile) and mostly unused for MVP.

## AI Testing Harness

Primitives in `mise-tasks/test-*` for automated testing:

```bash
mise run test-start / test-stop          # app lifecycle
mise run test-prompt "hello"             # send prompt, wait for response
mise run test-screenshot name            # capture to tmp/dev/name.png
mise run test-dump-state                 # log task/session/message state
mise run test-set-folder /path           # set working folder
mise run test-set-task <id>              # switch active task
mise run test-create-task "Title" [folder]
mise run test-delete-tasks
mise run test-auth-list / test-auth-set-key / test-auth-delete / test-auth-import-pi
mise run test-set-auth-profile <name>    # switch auth profile + restart
mise run test-send-login                 # trigger /login UI flow
mise run test-open-preview <task> <path> # open file preview
mise run test-check-permissions          # verify screenshot capture works
```

### Rules

- **Primitives only** — no monolithic E2E scripts. Compose primitives ad-hoc.
- **Evidence for claims** — always capture: `test-dump-state` + `test-screenshot` + relevant logs
- **Wait explicitly** — for async transitions, poll/wait; don't rely on fixed sleeps
- **Clean up** — always `test-stop` after testing
- Test server (port 19385) is debug-only (`#[cfg(debug_assertions)]`), redacts secrets in logs.

## Docs

- `docs/` — see `docs/README.md` for index
- `docs/research/` — Cowork observations, sandbox strategy, UI sketches

## Conventions

- 4-space indentation
- Use mise tasks, not direct pnpm/cargo
- Keep configs sorted
- Pre-alpha policy: breaking changes are acceptable; do not add migration/fallback/compat shims unless explicitly requested
