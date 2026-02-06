# Runtime Pack + VM Boot Flow

## Scope

This doc describes the **current dev/runtime-pack model** used by piwork.

Authoritative runtime rollout status lives in `runtime-taskd-plan.md`.

## Goal

Provide a consistent Linux runtime for desktop with explicit host folder mounting and predictable boot behavior.

## Current runtime pack (dev)

Built via:

- `mise run runtime-build`
- optional auth bake-in via `mise run runtime-build-auth`

Installed to:

- macOS: `~/Library/Application Support/com.pi.work/runtime`

Pack includes (current dev path):

- Alpine kernel + initramfs
- Node runtime
- pi CLI package
- `taskd.js`
- optional auth/env material

## VM boot flow (current)

1. Host checks runtime availability and launches QEMU.
2. QEMU boots kernel + initramfs directly (no bootloader).
3. Init script mounts:
   - `/mnt/workdir` (workspace mount)
   - `/mnt/taskstate` (task state mount)
   - `/mnt/authstate` (host auth profiles)
4. Init selects auth profile (`PI_CODING_AGENT_DIR`) from mounted auth state when available, with baked auth as fallback.
5. Init starts `taskd`.
6. Host waits for `READY`, then connects RPC on TCP `19384`.

## Transport (current)

- QEMU user-mode NAT + `hostfwd` to port `19384`.
- JSONL RPC over localhost TCP.

## Mount reliability note

The dev runtime injects required 9p modules from `linux-virt` into initramfs (`netfs`, `9pnet`, `9pnet_virtio`, `9p`) and loads them during init before mount attempts.

## Auth bake-in (dev fallback)

Mounted host auth state is preferred when available. Baked auth remains a fallback bootstrap path.

Supported inputs for runtime build:

- `PIWORK_AUTH_PATH`
- `PIWORK_COPY_AUTH=1`
- `PIWORK_AUTH_MODE=env`
- `ANTHROPIC_OAUTH_TOKEN`
- `ANTHROPIC_API_KEY`

## Production packaging (future)

Production-grade signed/verified downloadable packs are planned but not yet finalized. Keep signing/distribution requirements in ADR/plan docs rather than this file until that path is implemented.
