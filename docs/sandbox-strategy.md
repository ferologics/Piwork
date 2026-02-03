# Sandbox Strategy

## Goals

- Run locally on all platforms (macOS, Windows, Linux, iOS, Android).
- Provide strong, user-understandable safety boundaries.
- Keep behavior consistent across platforms where possible.
- Require hardened VM isolation on desktop without blocking mobile viability.

## Constraints

- **iOS**: no practical VM option (no hypervisor/JIT for third-party apps).
- **Android**: QEMU is possible but heavy and rarely hardware-accelerated in-app.
- **Desktop**: QEMU is viable and gives strong isolation + a uniform Linux tool environment.

## Recommended Model

### Mobile (iOS / Android)

**Native app sandbox + capability-based access**

- Agent runs **inside the app sandbox**.
- File access only through **explicit user grants** (file picker / scoped storage).
- **Tools are whitelisted** and implemented in-app (Rust), not arbitrary shell.
- Network access is **on by default**, but **policy-gated** (prompts/allowlist; per-task toggle optional).
- Write operations require explicit approval when outside a trusted workspace.

### Desktop (macOS / Windows / Linux)

**Default: Hardened VM (QEMU), required on desktop**

- Desktop runs **inside QEMU** (HVF/WHPX/KVM acceleration when available):
    - Strong kernel boundary
    - Uniform Linux environment for tools
    - Explicit host folder mounts only
    - Snapshot/rollback support
- If QEMU is unavailable or disabled, the app enters **setup-required mode** and does not run agent tasks.
- **Unsafe dev mode (optional):** OS-level sandbox only for local development/testing:
    - macOS: Seatbelt
    - Linux: Landlock + seccomp
    - Windows: AppContainer / WSL-backed sandbox (when available)

## Rationale and Competitive Signals

- **OpenAI Codex local** uses OS-level sandboxing (Seatbelt / Landlock / AppContainer), not a VM.
- **Anthropic Cowork (macOS)** appears to use **Apple Virtualization Framework** with a Linux rootfs (VM-based isolation).
- We use a **VM on desktop** and **native app sandbox on mobile** to stay cross-platform while keeping strong desktop isolation.

## Access Model (Common Across Platforms)

- **Workspace-based access**: agent only sees explicitly selected folders.
- **Mounts are user-driven** per session.
- **Connector tools** (GitHub/Notion/etc) require explicit enablement.
- **Network access**: on by default; prompt/allowlist for risky use cases.
- **Approvals**: write operations outside workspace require confirmation.

## Implementation Notes

- Define a `SandboxRuntime` abstraction with per-platform adapters:
    - `MobileSandboxRuntime` (native app sandbox + capability grants)
    - `QemuSandboxRuntime` (required on desktop)
    - `DesktopSandboxRuntime` (unsafe dev-only mode)
- Ship a **minimal toolset** on mobile; expand on desktop.
- Keep the **UI permissions model identical** across platforms.

## QEMU Distribution

- **Decision:** ship a **thin app** and download/install a **runtime pack** on first launch.
- Runtime pack includes QEMU binaries, firmware, kernel/initrd, and base rootfs.
- Install location is per-user (App Support / LocalAppData / ~/.local/share) and reused across app updates.
- Provide an **offline/full bundle** for air-gapped installs if needed.

## iOS App Store Compliance (Proposed)

- Bundle **pi + default skills/tools** in the app.
- **Disable dynamic installs** on iOS (no `pi install`, no downloading extensions).
- Ship new skills via **App Store updates** (or enable installs only in dev/sideload builds).
- Keep all execution within the **app sandbox** and **user-approved files**.

## Open Questions

- Which operations should require confirmation by default (writes, deletes, external tools)?
- What network prompts/allowlists do we enforce when network is on by default?
- How should we detect QEMU availability and guide users through setup?
- Where to host runtime packs, and how do we sign/verify updates?

## Next Steps

1. Confirm approval defaults + network policy details.
2. Define QEMU availability checks + setup-required flow.
3. Define runtime pack download/install/update flow.
4. Prototype `SandboxRuntime` interface and a minimal mobile toolset.
