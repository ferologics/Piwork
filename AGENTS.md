# AGENTS.md — Piwork

## Project Goal

Cowork-style UI on top of **pi** using **Tauri**. File-scoped tasks, sandboxed VM execution.

## Stack

- **Tauri 2** + **SvelteKit** + **pnpm**
- **Tailwind 4 + shadcn-svelte**
- **Vitest** (unit), Playwright deferred

## Commands

```bash
mise run setup              # install deps + git hooks
mise run check              # fast local gate (format/lint/compile/fast tests)
mise run check-full               # full gate (check + live regressions)
mise run test-regressions         # live app regression suite
mise run test-regressions-if-needed # run live regressions only when impacted files changed
mise run install-git-hooks  # reinstall pre-commit/pre-push hooks
mise run tauri-dev          # run app
mise run runtime-build      # build VM runtime pack
mise run runtime-build-auth # rebuild with auth baked in
mise run runtime-clean      # clean runtime artifacts
```

## Testing gates & hooks

- Git hooks are installed by `mise run setup` (or manually via `mise run install-git-hooks`).
- `pre-commit` runs `mise run check`.
- `pre-push` runs `mise run test-regressions-if-needed` (path-aware live regression gate).
- Successful `mise run test-regressions` on a clean HEAD writes a local success stamp (`.git/piwork/regressions-last-success`); pre-push skips rerunning live regressions when the stamped HEAD matches current HEAD.
- Set `PIWORK_FORCE_CHECK_FULL=1` to force full pre-push gate.
- CI (`.github/workflows/ci.yml`) always runs `check`; `check-full` runs only when integration-impacting paths changed.
- **Agent rule**: avoid running a redundant manual `mise run check` immediately before `git commit` when hooks are active; rely on pre-commit output unless explicit extra verification is requested.
- **Agent rule**: avoid rerunning manual `mise run test-regressions`/`mise run check-full` right before `git push` if they already passed on the same clean HEAD; rely on pre-push stamp skip unless explicit extra verification is requested.

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

| Mount     | Guest path       | Purpose                             |
| --------- | ---------------- | ----------------------------------- |
| workdir   | `/mnt/workdir`   | User's working folder               |
| taskstate | `/mnt/taskstate` | Per-task session files              |
| authstate | `/mnt/authstate` | Host auth state (`default` profile) |

### Auth (current state)

Working: bake credentials at build time, or write to `app_data/auth/default/auth.json` (mounted into VM).
Aspirational: OAuth `/login` flow through VM — unclear if it works through NAT.
Settings UI is now MVP-scoped (import from pi + status on default profile).

## AI Testing Harness

Primitives in `mise-tasks/test-*` for automated testing:

```bash
mise run test-start / test-stop          # app lifecycle
mise run test-prompt "hello"             # send prompt, wait for response
mise run test-screenshot name            # capture to tmp/dev/name.png
mise run test-dump-state                 # log task/session/message state
mise run test-state-snapshot             # structured UI/runtime snapshot JSON
mise run test-runtime-diag               # taskd diagnostics JSON (pending requests/history)
mise run test-set-folder /path           # one-time bind working folder for active task
mise run test-set-task <id>              # switch active task
mise run test-create-task "Title" [folder]
mise run test-delete-tasks
mise run test-auth-list / test-auth-set-key / test-auth-delete / test-auth-import-pi
mise run test-send-login                 # trigger /login UI flow
mise run test-open-preview <task> <path> # open file preview
mise run test-write-working-file <path> [content] # write file via runtime /mnt/workdir path
mise run test-open-working-folder <task> # open task working folder via Finder action path
mise run test-check-permissions          # verify screenshot capture works
```

### Rules

- **Primitives only** — no monolithic E2E scripts. Compose primitives ad-hoc.
- **Use structured snapshots for assertions** — prefer `test-state-snapshot` (or equivalent API calls) over log-grep assertions.
- **Evidence for claims** — always capture: `test-dump-state` + `test-screenshot` + relevant logs (and `test-runtime-diag` for timeout/regression diagnosis)
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
- Capture deferred work immediately: when decisions/ideas are parked, update `TODO.md` (and relevant docs if needed) in the same pass with a short rationale and revisit trigger
- Pre-alpha policy: breaking changes are acceptable; do not add migration/fallback/compat shims unless explicitly requested
