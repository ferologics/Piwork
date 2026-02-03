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

1. Download an Alpine aarch64 ISO (virt build) into `tmp/`:

   ```bash
   mkdir -p tmp
   curl -L \
     https://dl-cdn.alpinelinux.org/alpine/latest-stable/releases/aarch64/alpine-virt-3.23.3-aarch64.iso \
     -o tmp/alpine-virt-3.23.3-aarch64.iso
   ```

2. Run the spike harness (starts host stack + QEMU + static IP):

   ```bash
   scripts/run-mitm-spike.sh
   ```

3. Inspect logs + boot timing:

   ````bash
   tail -n 40 tmp/mitm-qemu.log
   tail -n 40 tmp/mitm-netdev.log
   cat tmp/mitm-boot.log # BOOT_MS=...   ```
   ````

You should see ARP + ICMP frames logged in the host stack. The harness assigns `192.168.100.2/24` and pings `192.168.100.1`, which should now receive a reply.

Boot timing is written to `tmp/mitm-boot.log` as `BOOT_MS=...`.

> Note: stream netdev uses a **4‑byte length prefix** per frame. The sniffer parses that framing.

### Cleanup

```bash
scripts/mitm-clean.sh
# remove the ISO too:
CLEAN_ISO=1 scripts/mitm-clean.sh
```

## Spike results (2026‑02‑03)

- ✅ Alpine aarch64 boots under QEMU with **stream netdev** (~7.6s to login on M2, first run).
- ✅ Host stack replies to **ARP + ICMP** (ping to `192.168.100.1` succeeds).
- ⚠️ No DHCP/IP routing yet (expected until a host network stack is implemented).

## Next steps

1. Expand host stack (DHCP + DNS + TCP) to allow outbound requests.
2. Add **allowlist policy** for a single hostname.
3. Decide whether to proceed to TLS MITM (custom CA + re‑encryption).
