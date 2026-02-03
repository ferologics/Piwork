#!/usr/bin/env bash
set -euo pipefail

ALPINE_ISO=${ALPINE_ISO:-}
NETDEV_SOCKET=${NETDEV_SOCKET:-/tmp/piwork-netdev.sock}
EFI_BIOS=${EFI_BIOS:-/opt/homebrew/share/qemu/edk2-aarch64-code.fd}

if [[ -z "$ALPINE_ISO" ]]; then
    echo "Set ALPINE_ISO to an Alpine aarch64 ISO path." >&2
    echo "Example: export ALPINE_ISO=~/Downloads/alpine-virt-3.23.3-aarch64.iso" >&2
    exit 1
fi

if [[ ! -f "$ALPINE_ISO" ]]; then
    echo "ISO not found: $ALPINE_ISO" >&2
    exit 1
fi

if [[ ! -f "$EFI_BIOS" ]]; then
    echo "UEFI firmware not found: $EFI_BIOS" >&2
    exit 1
fi

rm -f "$NETDEV_SOCKET"

qemu-system-aarch64 \
    -machine virt,accel=hvf \
    -cpu cortex-a72 \
    -smp 2 \
    -m 1024 \
    -nographic \
    -bios "$EFI_BIOS" \
    -cdrom "$ALPINE_ISO" \
    -device virtio-net-pci,netdev=net0 \
    -netdev stream,id=net0,server=on,addr.type=unix,addr.path="$NETDEV_SOCKET" \
    -serial mon:stdio
