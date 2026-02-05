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
mise run test-set-folder /path   # set working folder, restart VM
mise run test-set-task <id>      # set active task in UI
mise run test-create-task "Title" [folder]  # create a task
mise run test-dump-state         # log active task/session/message count
mise run test-verify-resume      # verify task resume + session isolation
mise run test-logs               # tail test logs
mise run test-stop               # kill app + QEMU
```

These let the AI test changes without human interaction:

1. `test-start` launches app and waits for "listening" in logs
2. `test-prompt` sends via TCP test server (port 19385), waits for "agent_end"
3. `test-screenshot` captures window without stealing focus
4. Test server only runs in debug builds (`#[cfg(debug_assertions)]`)

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

- `PIWORK_COPY_AUTH=1` / `PIWORK_AUTH_PATH=...` to bake `auth.json`
- `ANTHROPIC_OAUTH_TOKEN` baked into VM env; set `PIWORK_AUTH_MODE=env` to skip auth.json

**Requires**: 2GB RAM (initramfs unpacks to tmpfs)

## Key Decisions

- **TCP RPC** via NAT port forwarding (simpler than virtio-serial)
- **Network on by default** via QEMU user-mode NAT
- **Shared VM for now** (single VM, restarted on folder change)
- **Dynamic linking** - Node uses Alpine's packaged libs
- **Task resume** via host-stored conversation (pi session files VM-local; host persistence TODO)

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
