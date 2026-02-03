# Network MITM Spike (Armin‑style)

## Goal

Evaluate a **host‑side network interception** approach for the VM (virtio‑net + stream netdev) to enable **per‑request allow/deny** and full auditability. This is a possible future replacement for **NAT‑only** networking.

## Summary of the approach

- QEMU exposes **virtio‑net** with a **stream netdev**.
- A **host process** (Node/Rust) connects to the netdev socket and receives **raw Ethernet frames**.
- The host process implements the network stack (ARP/DNS/TCP/TLS).
- HTTP(S) is routed through **host fetch**, with **TLS re‑encryption** and **policy enforcement**.

This keeps the VM “talking Ethernet” while the host enforces per‑request policies.

## Why it matters

- **Hard egress control** (domain allowlists/denylists).
- **Request‑level auditing** across any process inside the VM.
- Prevents **exfiltration** even if a process bypasses tool‑level gates.

## Spike scope (timeboxed)

- Confirm QEMU supports **stream netdev** on macOS (via Homebrew QEMU).
- Create a minimal host process that **logs Ethernet frames**.
- Prove **request‑level blocking** (allow one hostname, block others).

> Full TLS MITM is non‑trivial. The spike focuses on **plumbing + policy**, not a full CA/PKI solution.

## Requirements / constraints

- QEMU with `stream` netdev (available in Homebrew QEMU 10.x).
- A VM image with **virtio‑net** enabled.
- Ability to install a **custom CA** in the VM (future step for TLS MITM).

## Open questions / risks

- **TLS pinning**: some clients ignore custom CAs.
- **Non‑HTTP traffic** (gRPC, websockets, raw TCP): need explicit handling.
- **Performance**: JS Ethernet stack may be fine for dev, but might need Rust for prod.
- **Complexity**: host stack becomes part of security‑critical surface.

## Recommendation (current)

- Keep **NAT** for v1 to ship faster.
- Treat MITM mode as a **future strict‑network option** once we validate the spike.

## Local PoC (macOS/arm64)

1. Download an Alpine aarch64 ISO (virt build):

   ```bash
   curl -L \
     https://dl-cdn.alpinelinux.org/alpine/latest-stable/releases/aarch64/alpine-virt-3.23.3-aarch64.iso \
     -o ~/Downloads/alpine-virt-3.23.3-aarch64.iso
   ```

2. Start the host netdev sniffer:

   ```bash
   NETDEV_SOCKET=/tmp/piwork-netdev.sock \
     node scripts/mitm-netdev-sniff.mjs
   ```

3. Boot QEMU with stream netdev:

   ```bash
   ALPINE_ISO=~/Downloads/alpine-virt-3.23.3-aarch64.iso \
   NETDEV_SOCKET=/tmp/piwork-netdev.sock \
     scripts/run-mitm-qemu.sh
   ```

4. Inside the VM, bring up network to generate traffic:

   ```sh
   setup-interfaces -a
   rc-service networking start
   ping -c 1 1.1.1.1
   ```

You should see Ethernet frames logged in the host sniffer.

> Note: the sniffer currently logs **raw chunks**. If frames look garbled, we may need to implement proper frame boundaries for the stream netdev protocol.

## Next steps

1. PoC: launch a tiny VM with **virtio‑net + stream netdev**.
2. Host process: read frames, parse ARP/IP/TCP, log destinations.
3. Add **allowlist policy** for a single hostname.
4. Decide whether to proceed to TLS MITM (custom CA + re‑encryption).
