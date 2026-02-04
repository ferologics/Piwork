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

1. Download an Alpine aarch64 ISO (virt build) into `tmp/` (one‑time):

   ```bash
   mkdir -p tmp
   curl -L \
     https://dl-cdn.alpinelinux.org/alpine/latest-stable/releases/aarch64/alpine-virt-3.23.3-aarch64.iso \
     -o tmp/alpine-virt-3.23.3-aarch64.iso
   ```

2. Run the spike harness (extracts kernel + direct‑boots QEMU):

   ```bash
   scripts/run-mitm-spike.sh
   ```

3. Inspect logs + boot timing:

   ```bash
   tail -n 40 tmp/mitm-qemu.log
   tail -n 40 tmp/mitm-netdev.log
   cat tmp/mitm-boot.log # BOOT_MS=...
   ```

You should see DHCP, DNS, ARP, ICMP, and HTTP logs from the host stack. The VM uses `udhcpc` (limited retries), runs `nslookup example.com`, requests `http://example.com`, and pings `192.168.100.1`.

The harness direct‑boots the kernel/initramfs extracted from the ISO. A fast initramfs (custom `/init`, no OpenRC) is generated to reduce boot time.

Boot timing is written to `tmp/mitm-boot.log` as `BOOT_MS=...`.

> Note: stream netdev uses a **4‑byte length prefix** per frame. The sniffer parses that framing.

### Cleanup

```bash
scripts/mitm-clean.sh
# remove the ISO + extracted kernel + fast initramfs:
CLEAN_ISO=1 scripts/mitm-clean.sh
```

## Spike results (2026‑02‑03)

- ✅ Alpine aarch64 boots under QEMU with **stream netdev** (~7.6s to login on M2, first run).
- ✅ Host stack replies to **DHCP + DNS + ARP + ICMP + HTTP** (`udhcpc` gets a lease, `nslookup example.com` succeeds, `wget http://example.com` returns stub, ping succeeds).
- ✅ Boot timing measured: ~1.1s to login on M2 with direct kernel boot (was ~7.6s with UEFI/GRUB).
- ✅ Fast initramfs boot timing measured: **~0.47s** to READY on M2.

## Next steps

1. Expand host stack (TCP) to allow outbound requests.
2. Add **allowlist policy** for a single hostname at TCP/HTTP layer.
3. Decide whether to proceed to TLS MITM (custom CA + re‑encryption).
4. Decide if we want to keep fast‑initramfs boot path in the runtime pack.
