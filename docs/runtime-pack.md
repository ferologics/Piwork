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
- **Install location (per‑user):**
    - macOS: `~/Library/Application Support/pui/runtime/`
    - Windows: `%LOCALAPPDATA%\pui\runtime\`
    - Linux: `~/.local/share/pui/runtime/`
- **Updates:** app checks for new pack versions and upgrades in‑place.
- **Rollback:** keep previous pack for one release cycle.

## Integrity & Signing

- Pack includes **SHA‑256 checksums** for all files.
- Pack is **signed**; app verifies before install.
- Refuse to run if verification fails.

## VM Boot Flow (Proposed)

1. **Preflight**
   - Verify runtime pack installed and valid
   - Check accel: **HVF / WHPX / KVM**
   - If missing → show setup guidance

2. **Prepare task sandbox**
   - Create **ephemeral overlay** (qcow2) from base rootfs
   - Create **workspace mount** (read/write)
   - Optional **cache volume** for packages

3. **Launch QEMU**
   - Enable accel (HVF/WHPX/KVM)
   - Attach rootfs overlay + cache volume
   - Attach workspace via **virtiofs** (fallback to 9p)
   - Attach **virtio‑serial** channel for RPC
   - Configure **network on by default** (policy‑gated)

4. **Start pi in VM**
   - Bootstrap service launches `pi --mode rpc`
   - RPC listens on `/dev/virtio-ports/pui.rpc`

5. **Host ↔ VM handshake**
   - UI connects to the virtio‑serial stream
   - Task starts once RPC is ready

## Host ↔ VM Communication

**Single path:** **virtio‑serial** (no network stack needed)

- VM exposes a virtio‑serial port (e.g., `/dev/virtio-ports/pui.rpc`)
- Host connects via a local socket / named pipe
- pi RPC uses JSONL over this stream (RPC mode already supports stdio‑style streams)

## Mount & Scope Model

- **Only user‑selected folders are mounted**
- Each mount is read/write or read‑only
- No host home directory access by default

## Network Policy (v1)

- **Default: network on**
- Prompt/allowlist for network‑using commands
- Optional per‑task “offline” mode
- Web search can still be routed via host tool if we run offline

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
