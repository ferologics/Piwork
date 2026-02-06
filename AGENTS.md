# AGENTS.md — Piwork

## Project Goal

Build a Cowork‑style, normie‑first UI on top of **pi** using **Tauri**. Focus on file‑scoped tasks, progress visibility, and artifacts/canvas previews.

## Stack

- **Tauri 2** + **SvelteKit** + **pnpm**
- **Tailwind 4 + shadcn‑svelte**
- **Testing:** Vitest (RPC mock; Playwright deferred)

## Commands

Use **mise** for everything:

```bash
mise run check          # format + lint + compile + test
mise run tauri-dev      # run app interactively (for humans)
mise run runtime-build       # build VM runtime pack
mise run runtime-build-auth  # force rebuild with auth baked in (uses ANTHROPIC_OAUTH_TOKEN if set)
mise run runtime-clean       # clean runtime artifacts
```

## AI Testing Harness

File-based tasks in `mise-tasks/` for automated AI development:

```bash
mise run test-start              # start app, wait for ready
mise run test-prompt "hello"     # send prompt, wait for response
mise run test-screenshot name    # capture to tmp/dev/name.png
mise run test-check-permissions   # verify screenshot permission/visibility
mise run test-open-preview <task-id> <relative-path>  # open main-pane preview for a file
mise run test-set-folder /path   # set working folder
mise run test-set-task <id>      # set active task in UI
mise run test-set-auth-profile <profile>  # set auth profile, restart runtime, wait until applied
mise run test-auth-list [profile]         # inspect auth store entries
mise run test-auth-set-key <provider> <key> [profile]  # write API key to auth store
mise run test-auth-delete <provider> [profile]          # delete provider from auth store
mise run test-auth-import-pi [profile]    # import ~/.pi auth into auth store
mise run test-create-task "Title" [folder]  # create a task
mise run test-delete-tasks       # delete all tasks
mise run test-dump-state         # log active task/session/message count
mise run test-logs               # tail test logs
mise run test-stop               # kill app + QEMU
```

These let the AI test changes without human interaction:

1. `test-start` launches app and waits for "listening" in logs
2. `test-prompt` sends via TCP test server (port 19385), waits for "agent_end"
3. `test-screenshot` captures window without stealing focus (and fails if capture is blank/black)
4. Test server only runs in debug builds (`#[cfg(debug_assertions)]`)

Prerequisite: grant Screen Recording permission to the terminal app running `mise`/Piwork, otherwise screenshot checks will fail (`mise run test-check-permissions`).

### AI testing workflow (important)

- Prefer **ad-hoc primitive tasks** (`test-create-task`, `test-set-task`, `test-set-auth-profile`, `test-auth-list`, `test-auth-set-key`, `test-auth-delete`, `test-prompt`, `test-open-preview`, `test-dump-state`, `test-screenshot`) over monolithic end-to-end scripts.
- Reusable suite scripts live in `scripts/harness/` (current: `path-i-lite-negative.sh`, `auth-profile-mount-smoke.sh`, `auth-profile-switch-smoke.sh`, `auth-store-primitives-smoke.sh`).
- For any UI/state claim, capture all three before concluding:
  1. `test-dump-state` (state snapshot)
  2. `test-screenshot <name>` (visual proof)
  3. relevant log lines (`tmp/dev/piwork.log`, `qemu.log`) only as supporting evidence
- For async transitions (task switch, VM restart), wait/poll explicitly; do not rely on fixed sleeps alone.
- For resume checks, validate semantics (e.g. task-local memory question with unique seed text), not only message counts.
- Do not add new `mise` tasks for one-off debugging flows; only add reusable primitives.
- Always run `mise run test-stop` after automated testing to avoid stale ports/processes.
- Test-server command logs redact sensitive JSON fields (`key`, `token`, `password`, `secret`).

## VM Runtime

**Architecture**: QEMU VM with Alpine Linux, pi runs inside via TCP RPC.

**Boot time**: ~1s to READY, ~0.7s first RPC response

**Files** (in `~/Library/Application Support/com.pi.work/runtime/`):

- `vmlinuz-virt` (10MB) - Linux kernel
- `initramfs-virt-fast` (51MB) - Alpine + Node.js + pi
- `manifest.json` - config

**How it works**:

1. QEMU boots kernel + initramfs (direct boot, no bootloader)
2. Init script: mount filesystems, get DHCP, print "READY" to serial
3. `nc -l -p 19384 -e node pi --mode rpc` bridges TCP to pi stdin/stdout
4. Host connects to `localhost:19384` for RPC

**Building** (`mise run runtime-build`):

1. Downloads Alpine ISO (cached)
2. Extracts kernel + base initramfs
3. Downloads Node.js + deps from Alpine APKs (16 packages)
4. Copies pi from global npm install
5. Bundles into initramfs with custom init script
6. Installs to app data dir

Auth options (dev):

- Host auth profiles are mounted into VM at `/mnt/authstate` (selected via `piwork:auth-profile`, default `default`)
- `PIWORK_COPY_AUTH=1` / `PIWORK_AUTH_PATH=...` to bake `auth.json` as fallback
- `ANTHROPIC_OAUTH_TOKEN` baked into VM env; set `PIWORK_AUTH_MODE=env` to skip auth.json

**Requires**: 2GB RAM (initramfs unpacks to tmpfs)

## Key Decisions

- **TCP RPC** via NAT port forwarding (simpler than virtio-serial)
- **Network on by default** via QEMU user-mode NAT
- **Shared VM for now** (single VM, restarted on task/folder switch to remount active paths)
- **Dynamic linking** - Node uses Alpine's packaged libs
- **Task resume** via host-backed per-task session file (`/mnt/taskstate/session.json`) + host transcript cache

## Docs

Core technical docs:

- `docs/runtime-pack.md` - runtime pack format
- `docs/pi-integration.md` - RPC protocol
- `docs/auth-flow.md` - authentication
- `docs/permissions-model.md` - folder access
- `docs/network-mitm-spike.md` - future network interception
- `docs/ui-roadmap.md` - UI feature comparison with Cowork
- `docs/testing-strategy.md` - test infrastructure

Research/reference (in `docs/research/`):

- Cowork observation notes and feature maps
- Hero workflow ideas
- UI layout sketches and capability maps

## Conventions

- 4‑space indentation
- Use mise tasks, not direct pnpm/cargo
- Keep configs sorted
