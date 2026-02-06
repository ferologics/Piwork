# Runtime Pack + VM Boot Flow (Draft)

## Goal

Provide a **consistent, isolated Linux environment** for desktop while keeping the app thin. Use a **downloaded runtime pack** on first launch and run pi inside a QEMU VM with explicit folder mounts.

## Decision Summary

- **QEMU is required on desktop** (macOS/Windows/Linux).
- The app downloads a **runtime pack** on first launch and installs it per‑user.
- If QEMU or hardware acceleration is unavailable → **setup‑required mode** (no tasks run).
- Optional **offline/full bundle** for air‑gapped installs.

## Runtime Pack Contents (Proposed)

- **QEMU binaries** (per‑OS/arch)
- **Firmware** (OVMF/UEFI)
- **Kernel + initrd**
- **Base rootfs** (minimal Linux)
- **Node runtime + pi CLI** (preinstalled)
- **VM bootstrap service** (starts pi RPC server)
- **CA certificates**
- **Manifest** (version, checksums, signatures, compatibility)

## Packaging & Delivery

- **Pack format:** `tar.zst` with `manifest.json` + signatures.
- **Install location (per‑user):** app data dir + `/runtime`.
- **Dev override:** set `PIWORK_RUNTIME_DIR` to point at a local runtime pack.
- **Local dev pack:** `mise run runtime-install-dev` (uses Alpine ISO).
  - The dev pack prebakes **Node + pi** into the initramfs via `scripts/prepare-runtime-pi.sh`.
  - Optional dev auth: set `PIWORK_AUTH_PATH=~/.pi/agent/auth.json` (or `PIWORK_COPY_AUTH=1`) to bake auth into the initramfs.
  - When `PIWORK_COPY_AUTH=1`, the installer first checks the app auth store at `app_data/auth/<profile>/auth.json` (profile defaults to `default`, override with `PIWORK_AUTH_PROFILE`).
  - You can also bake `ANTHROPIC_OAUTH_TOKEN` / `ANTHROPIC_API_KEY` into the VM env. To prefer env over auth.json, set `PIWORK_AUTH_MODE=env`.
  - Override Node version with `PIWORK_NODE_VERSION` if needed.
  - Note: if no RPC port is available, the initramfs prints `READY` to console (log via `app_data/vm/qemu.log`).
- **Updates:** app checks for new pack versions and upgrades in‑place.
- **Rollback:** keep previous pack for one release cycle.

## Integrity & Signing

- Pack includes **SHA‑256 checksums** for all files.
- Pack is **signed**; app verifies before install.
- Refuse to run if verification fails.

## VM Boot Flow (Current)

1. **Preflight**
   - Verify runtime pack installed and valid
   - Check accel: **HVF / WHPX / KVM**
   - If missing → show setup guidance

2. **Launch QEMU**
   - Direct boot kernel + initramfs
   - Enable accel (HVF/WHPX/KVM)
   - Enable **user‑mode NAT (SLIRP)** with `hostfwd` for TCP RPC

3. **Start pi in VM**
   - Init script launches `nc -l -p 19384 -e node pi --mode rpc`

4. **Host ↔ VM handshake**
   - UI connects to `localhost:19384`
   - Task starts once RPC is ready

> **Note:** v2 dev runtime now injects required 9p modules into initramfs and mounts workspace/taskstate at boot (`/mnt/workdir`, `/mnt/taskstate`).
> **Future:** evaluate virtiofs and stronger per-task sandbox layering.

## Host ↔ VM Communication

**Single path:** **virtio‑serial** (no network stack needed)

- VM exposes a virtio‑serial port (e.g., `/dev/virtio-ports/piwork.rpc`)
- Host connects via a local socket / named pipe
- pi RPC uses JSONL over this stream (RPC mode already supports stdio‑style streams)

## Mount & Scope Model

- **Only user‑selected folders are mounted**
- Each mount is read/write or read‑only
- No host home directory access by default

## Network Policy (v1)

- **Default: network on** via **user‑mode NAT (SLIRP)**
- Prompt/allowlist for network‑using commands (non‑search)
- Optional per‑task “offline” mode
- Web search can still be routed via host tool if we run offline

**Later (optional):** host‑proxy/allowlist model (Codex‑style) if needed.

Potential MITM mode (future idea):

- Use **virtio‑net + stream netdev** to pipe Ethernet frames to a host process.
- Host JS stack handles DNS/TCP + TLS re‑encryption for **per‑request control**.

## Task Isolation

- **v1:** each task runs in a **fresh overlay** (clean state, best isolation)
- **Later:** optional warm‑pool optimization (pre‑booted VM) if startup feels slow

## Setup‑Required Mode

Shown when:

- Runtime pack is missing or corrupt
- Acceleration unavailable
- VM fails health check

UI should offer:

- “Install runtime” button
- “Enable virtualization” help links

## Open Questions

- How to handle **cache volume** safely between tasks
- Whether to enforce **domain allowlists** or rely on prompts
- Do we ever need host‑proxy networking, or is NAT sufficient long‑term?
