#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
ROOT_DIR=$(cd "$SCRIPT_DIR/../.." && pwd)
TMP_DIR=${TMP_DIR:-$ROOT_DIR/tmp}
ALPINE_ISO=${ALPINE_ISO:-$TMP_DIR/alpine-virt-3.23.3-aarch64.iso}
NETDEV_SOCKET=${NETDEV_SOCKET:-$TMP_DIR/piwork-netdev.sock}
EFI_BIOS=${EFI_BIOS:-/opt/homebrew/share/qemu/edk2-aarch64-code.fd}
KERNEL_IMAGE=${ALPINE_KERNEL:-$TMP_DIR/boot/vmlinuz-virt}
INITRD_IMAGE=${ALPINE_INITRD:-$TMP_DIR/boot/initramfs-virt}
INITRD_FAST=${ALPINE_INITRD_FAST:-$TMP_DIR/boot/initramfs-virt-fast}
KERNEL_CMDLINE_FILE=${KERNEL_CMDLINE_FILE:-$TMP_DIR/alpine-kernel.cmdline}
KERNEL_CMDLINE=${KERNEL_CMDLINE:-"modules=loop,squashfs,sd-mod,usb-storage quiet console=ttyAMA0"}

mkdir -p "$TMP_DIR"

if [[ -z "$ALPINE_ISO" ]]; then
    echo "Set ALPINE_ISO to an Alpine aarch64 ISO path." >&2
    echo "Example: export ALPINE_ISO=$TMP_DIR/alpine-virt-3.23.3-aarch64.iso" >&2
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

cleanup() {
    rm -f "$NETDEV_SOCKET"
}

trap cleanup EXIT

rm -f "$NETDEV_SOCKET"

if [[ -f "$KERNEL_CMDLINE_FILE" ]]; then
    KERNEL_CMDLINE=$(cat "$KERNEL_CMDLINE_FILE")
fi

if [[ -f "$KERNEL_IMAGE" && -f "$INITRD_FAST" ]]; then
    INITRD_IMAGE="$INITRD_FAST"
fi

if [[ -f "$KERNEL_IMAGE" && -f "$INITRD_IMAGE" ]]; then
    qemu-system-aarch64 \
        -machine virt,accel=hvf \
        -cpu host \
        -smp 2 \
        -m 1024 \
        -nographic \
        -kernel "$KERNEL_IMAGE" \
        -initrd "$INITRD_IMAGE" \
        -append "$KERNEL_CMDLINE" \
        -cdrom "$ALPINE_ISO" \
        -device virtio-net-pci,netdev=net0,mac=52:54:00:12:34:56 \
        -netdev stream,id=net0,server=on,addr.type=unix,addr.path="$NETDEV_SOCKET" \
        -serial mon:stdio
    exit 0
fi

qemu-system-aarch64 \
    -machine virt,accel=hvf \
    -cpu host \
    -smp 2 \
    -m 1024 \
    -nographic \
    -bios "$EFI_BIOS" \
    -cdrom "$ALPINE_ISO" \
    -device virtio-net-pci,netdev=net0,mac=52:54:00:12:34:56 \
    -netdev stream,id=net0,server=on,addr.type=unix,addr.path="$NETDEV_SOCKET" \
    -serial mon:stdio
