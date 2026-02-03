#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
ROOT_DIR=$(cd "$SCRIPT_DIR/.." && pwd)
TMP_DIR=${TMP_DIR:-$ROOT_DIR/tmp}
ALPINE_ISO=${ALPINE_ISO:-$TMP_DIR/alpine-virt-3.23.3-aarch64.iso}
NETDEV_SOCKET=${NETDEV_SOCKET:-$TMP_DIR/piwork-netdev.sock}
SNIFF_LOG=${SNIFF_LOG:-$TMP_DIR/mitm-netdev.log}
QEMU_LOG=${QEMU_LOG:-$TMP_DIR/mitm-qemu.log}

mkdir -p "$TMP_DIR"

if [[ ! -f "$ALPINE_ISO" ]]; then
    echo "ISO not found: $ALPINE_ISO" >&2
    echo "Download to tmp/ first (see docs/network-mitm-spike.md)." >&2
    exit 1
fi

cleanup() {
    if [[ -n "${SNIFF_PID:-}" ]]; then
        kill "$SNIFF_PID" 2>/dev/null || true
    fi
}

trap cleanup EXIT

NETDEV_SOCKET="$NETDEV_SOCKET" \
    node "$SCRIPT_DIR/mitm-netdev-sniff.mjs" > "$SNIFF_LOG" 2>&1 &
SNIFF_PID=$!

TMP_DIR="$TMP_DIR" NETDEV_SOCKET="$NETDEV_SOCKET" expect <<EOF
set timeout 120
log_file -a $QEMU_LOG
spawn $SCRIPT_DIR/run-mitm-qemu.sh
expect {
    -re "login:" {}
    timeout { exit 1 }
}
send "root\r"
expect -re "#"
send "ip link set eth0 up\r"
expect -re "#"
send "ip addr add 192.168.100.2/24 dev eth0\r"
expect -re "#"
send "ip route add default via 192.168.100.1\r"
expect -re "#"
send "ping -c 1 192.168.100.1\r"
expect -re "#"
send "poweroff\r"
expect eof
EOF
