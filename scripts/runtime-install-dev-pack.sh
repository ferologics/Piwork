#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
ROOT_DIR=$(cd "$SCRIPT_DIR/.." && pwd)
TMP_DIR=${TMP_DIR:-$ROOT_DIR/tmp}
ALPINE_ISO=${ALPINE_ISO:-$TMP_DIR/alpine-virt-3.23.3-aarch64.iso}
KERNEL_IMAGE=${ALPINE_KERNEL:-$TMP_DIR/boot/vmlinuz-virt}
INITRD_FAST=${ALPINE_INITRD_FAST:-$TMP_DIR/boot/initramfs-virt-fast}
KERNEL_CMDLINE_FILE=${KERNEL_CMDLINE_FILE:-$TMP_DIR/alpine-kernel.cmdline}
RUNTIME_DIR=$($SCRIPT_DIR/runtime-path.sh)
MANIFEST_PATH="$RUNTIME_DIR/manifest.json"

mkdir -p "$TMP_DIR"

if [[ ! -f "$ALPINE_ISO" ]]; then
    echo "ISO not found: $ALPINE_ISO" >&2
    echo "Download to tmp/ first (see docs/network-mitm-spike.md)." >&2
    exit 1
fi

"$SCRIPT_DIR/prepare-alpine-kernel.sh"
rm -f "$INITRD_FAST"
"$SCRIPT_DIR/prepare-alpine-fastinit.sh"

mkdir -p "$RUNTIME_DIR"

cp -f "$KERNEL_IMAGE" "$RUNTIME_DIR/vmlinuz-virt"
cp -f "$INITRD_FAST" "$RUNTIME_DIR/initramfs-virt-fast"

if [[ -f "$KERNEL_CMDLINE_FILE" ]]; then
    cp -f "$KERNEL_CMDLINE_FILE" "$RUNTIME_DIR/kernel.cmdline"
fi

cat > "$MANIFEST_PATH" <<EOF
{
    "version": "dev-alpine-virt-3.23.3",
    "kernel": "vmlinuz-virt",
    "initrd": "initramfs-virt-fast",
    "cmdline": "$(cat "$KERNEL_CMDLINE_FILE" 2>/dev/null || echo "modules=loop,squashfs,sd-mod,usb-storage quiet console=ttyAMA0")",
    "notes": "Dev runtime pack generated from Alpine virt ISO."
}
EOF

echo "Runtime pack installed at: $RUNTIME_DIR"
