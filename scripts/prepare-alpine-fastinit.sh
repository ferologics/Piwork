#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
ROOT_DIR=$(cd "$SCRIPT_DIR/.." && pwd)
TMP_DIR=${TMP_DIR:-$ROOT_DIR/tmp}
INITRAMFS_ORIG=${INITRAMFS_ORIG:-$TMP_DIR/boot/initramfs-virt}
INITRAMFS_FAST=${INITRAMFS_FAST:-$TMP_DIR/boot/initramfs-virt-fast}
FAST_DIR=${FAST_DIR:-$TMP_DIR/initramfs-fast}

if [[ ! -f "$INITRAMFS_ORIG" ]]; then
    echo "initramfs not found: $INITRAMFS_ORIG" >&2
    exit 1
fi

if [[ -f "$INITRAMFS_FAST" ]]; then
    exit 0
fi

rm -rf "$FAST_DIR"
mkdir -p "$FAST_DIR"

bsdtar -xf "$INITRAMFS_ORIG" -C "$FAST_DIR"

cat > "$FAST_DIR/init" <<'EOF'
#!/bin/sh
export PATH=/usr/bin:/bin:/sbin

mount -t proc proc /proc
mount -t sysfs sysfs /sys
mount -t devtmpfs dev /dev
mount -t tmpfs tmpfs /run

modprobe virtio_pci 2>/dev/null || true
modprobe virtio_net 2>/dev/null || true
modprobe virtio_console 2>/dev/null || true

ip link set eth0 up
udhcpc -i eth0 -q -n -t 3 -T 1

RPC_PORT=/dev/virtio-ports/piwork.rpc
if [ -e "$RPC_PORT" ]; then
    echo READY > "$RPC_PORT"
fi

echo READY
exec /usr/bin/sh -i
EOF

chmod +x "$FAST_DIR/init"

(
    cd "$FAST_DIR"
    find . -print0 | cpio --null -o -H newc | gzip -9 > "$INITRAMFS_FAST"
)
