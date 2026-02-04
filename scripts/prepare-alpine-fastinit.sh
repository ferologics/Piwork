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
export PATH=/usr/local/bin:/usr/bin:/bin:/sbin

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

setup_repos() {
    cat > /etc/apk/repositories <<'REPOS'
http://dl-cdn.alpinelinux.org/alpine/v3.23/main
http://dl-cdn.alpinelinux.org/alpine/v3.23/community
REPOS
}

install_pi() {
    setup_repos
    apk add --no-cache ca-certificates nodejs npm bash git
    update-ca-certificates 2>/dev/null || true
    npm install -g @mariozechner/pi-coding-agent --omit=optional
}

start_pi() {
    echo READY > "$RPC_PORT"
    pi --mode rpc < "$RPC_PORT" > "$RPC_PORT" 2>/dev/null &
}

rpc_loop() {
    local rpc_port="$1"
    while IFS= read -r line; do
        if echo "$line" | grep -q '"type":"prompt"'; then
            echo '{"type":"response","command":"prompt","success":true}' > "$rpc_port"
            echo '{"type":"message_update","role":"assistant","content":"Piwork stub: received prompt"}' > "$rpc_port"
            echo '{"type":"agent_end","reason":"completed"}' > "$rpc_port"
        else
            echo '{"type":"message_update","role":"assistant","content":"Piwork stub: received command"}' > "$rpc_port"
        fi
    done < "$rpc_port"
}

start_stub() {
    echo READY > "$RPC_PORT"
    rpc_loop "$RPC_PORT" &
}

if [ -e "$RPC_PORT" ]; then
    if command -v pi >/dev/null 2>&1; then
        start_pi
    else
        if install_pi; then
            start_pi
        else
            echo '{"type":"message_update","role":"assistant","content":"Piwork stub: pi install failed"}' > "$RPC_PORT"
            start_stub
        fi
    fi
fi

exec /usr/bin/sh -i
EOF

chmod +x "$FAST_DIR/init"

(
    cd "$FAST_DIR"
    find . -print0 | cpio --null -o -H newc | gzip -9 > "$INITRAMFS_FAST"
)
