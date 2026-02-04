#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
ROOT_DIR=$(cd "$SCRIPT_DIR/.." && pwd)
TMP_DIR=${TMP_DIR:-$ROOT_DIR/tmp}
ALPINE_ISO=${ALPINE_ISO:-$TMP_DIR/alpine-virt-3.23.3-aarch64.iso}
KERNEL_CMDLINE_FILE=${KERNEL_CMDLINE_FILE:-$TMP_DIR/alpine-kernel.cmdline}

mkdir -p "$TMP_DIR"

if [[ ! -f "$ALPINE_ISO" ]]; then
    echo "ISO not found: $ALPINE_ISO" >&2
    exit 1
fi

if [[ -f "$TMP_DIR/boot/vmlinuz-virt" && -f "$TMP_DIR/boot/initramfs-virt" ]]; then
    exit 0
fi

bsdtar -xf "$ALPINE_ISO" -C "$TMP_DIR" \
    boot/vmlinuz-virt \
    boot/initramfs-virt \
    boot/modloop-virt \
    boot/grub/grub.cfg

if [[ -f "$TMP_DIR/boot/grub/grub.cfg" ]]; then
    cmdline=$(rg -m1 "^linux" "$TMP_DIR/boot/grub/grub.cfg" | sed -E "s/^linux[[:space:]]+\/boot\/vmlinuz-virt[[:space:]]*//")
    if [[ -n "$cmdline" ]]; then
        echo "$cmdline" > "$KERNEL_CMDLINE_FILE"
    fi
fi
