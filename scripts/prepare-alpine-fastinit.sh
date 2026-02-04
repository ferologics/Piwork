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

if [[ -n "${PIWORK_NODE_DIR:-}" && -d "$PIWORK_NODE_DIR" ]]; then
    mkdir -p "$FAST_DIR/opt/node"
    rsync -a "$PIWORK_NODE_DIR/" "$FAST_DIR/opt/node/"
fi

if [[ -n "${PIWORK_PI_DIR:-}" && -d "$PIWORK_PI_DIR" ]]; then
    mkdir -p "$FAST_DIR/opt/pi"
    rsync -a "$PIWORK_PI_DIR/" "$FAST_DIR/opt/pi/"
    mkdir -p "$FAST_DIR/usr/local/bin"
    cat > "$FAST_DIR/usr/local/bin/pi" <<'EOF'
#!/bin/sh
export NODE_PATH=/opt/pi/node_modules
export PI_PACKAGE_DIR=/opt/pi
exec /opt/node/bin/node /opt/pi/dist/cli.js "$@"
EOF
    chmod +x "$FAST_DIR/usr/local/bin/pi"
fi

if [[ -n "${PIWORK_AUTH_PATH:-}" && -f "$PIWORK_AUTH_PATH" ]]; then
    mkdir -p "$FAST_DIR/opt/pi-agent"
    cp -f "$PIWORK_AUTH_PATH" "$FAST_DIR/opt/pi-agent/auth.json"
    chmod 600 "$FAST_DIR/opt/pi-agent/auth.json" || true
fi

cat > "$FAST_DIR/init" <<'EOF'
#!/bin/sh
export PATH=/opt/node/bin:/usr/local/bin:/usr/bin:/bin:/sbin
export NODE_PATH=/opt/pi/node_modules
export PI_PACKAGE_DIR=/opt/pi

mount -t proc proc /proc
mount -t sysfs sysfs /sys
mount -t devtmpfs dev /dev
mount -t tmpfs tmpfs /run

modprobe virtio_pci 2>/dev/null || true
modprobe virtio_net 2>/dev/null || true
modprobe virtio_console 2>/dev/null || true

ip link set eth0 up
udhcpc -i eth0 -q -n -t 3 -T 1

if [ -f /opt/pi-agent/auth.json ]; then
    export PI_CODING_AGENT_DIR=/opt/pi-agent
fi

RPC_PORT=/dev/virtio-ports/piwork.rpc

emit_text() {
    local text="$1"
    printf '{"type":"message_update","assistantMessageEvent":{"type":"text_delta","contentIndex":0,"delta":"%s"}}\n' "$text" > "$RPC_PORT"
    printf '{"type":"message_update","assistantMessageEvent":{"type":"text_end","contentIndex":0,"content":"%s"}}\n' "$text" > "$RPC_PORT"
    printf '{"type":"message_update","assistantMessageEvent":{"type":"done","reason":"stop"}}\n' > "$RPC_PORT"
}

start_pi() {
    emit_text "Starting pi RPC..."
    echo READY > "$RPC_PORT"
    pi --mode rpc < "$RPC_PORT" > "$RPC_PORT" 2>/dev/null &
}

if [ -e "$RPC_PORT" ]; then
    if command -v pi >/dev/null 2>&1; then
        start_pi
    else
        echo READY > "$RPC_PORT"
        emit_text "Pi runtime missing in initramfs"
    fi
fi

exec /usr/bin/sh -i
EOF

chmod +x "$FAST_DIR/init"

(
    cd "$FAST_DIR"
    find . -print0 | cpio --null -o -H newc | gzip -9 > "$INITRAMFS_FAST"
)
