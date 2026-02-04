#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
ROOT_DIR=$(cd "$SCRIPT_DIR/.." && pwd)
TMP_DIR=${TMP_DIR:-$ROOT_DIR/tmp}
ALPINE_ISO=${ALPINE_ISO:-$TMP_DIR/alpine-virt-3.23.3-aarch64.iso}
NETDEV_SOCKET=${NETDEV_SOCKET:-$TMP_DIR/piwork-netdev.sock}
HOST_LOG=${HOST_LOG:-$TMP_DIR/mitm-netdev.log}
QEMU_LOG=${QEMU_LOG:-$TMP_DIR/mitm-qemu.log}
BOOT_LOG=${BOOT_LOG:-$TMP_DIR/mitm-boot.log}

mkdir -p "$TMP_DIR"

if [[ ! -f "$ALPINE_ISO" ]]; then
    echo "ISO not found: $ALPINE_ISO" >&2
    echo "Download to tmp/ first (see docs/network-mitm-spike.md)." >&2
    exit 1
fi

"$SCRIPT_DIR/prepare-alpine-kernel.sh"
"$SCRIPT_DIR/prepare-alpine-fastinit.sh"

cleanup() {
    if [[ -n "${HOST_PID:-}" ]]; then
        kill "$HOST_PID" 2>/dev/null || true
    fi
}

trap cleanup EXIT

NETDEV_SOCKET="$NETDEV_SOCKET" \
    HOST_IP=192.168.100.1 \
    HOST_MAC=02:50:00:00:00:01 \
    ALLOWED_DOMAINS=example.com \
    DNS_RESPONSE_IP=192.168.100.1 \
    node "$SCRIPT_DIR/mitm-netdev-host.mjs" > "$HOST_LOG" 2>&1 &
HOST_PID=$!

TMP_DIR="$TMP_DIR" NETDEV_SOCKET="$NETDEV_SOCKET" expect <<EOF > "$BOOT_LOG"
set timeout 120
log_user 0
set start [clock milliseconds]
log_file -a $QEMU_LOG
spawn $SCRIPT_DIR/run-mitm-qemu.sh
expect {
    -re "READY" {
        set end [clock milliseconds]
        set delta [expr {\$end - \$start}]
        send_user "BOOT_MS=\$delta\n"
    }
    timeout {
        send_user "BOOT_TIMEOUT\n"
        exit 1
    }
}
expect -re "#"
send "nslookup example.com\r"
expect -re "#"
send "wget -qO- -T 5 -t 1 http://example.com\r"
expect -re "#"
send "ping -c 1 192.168.100.1\r"
expect -re "#"
send "poweroff\r"
expect eof
EOF

if [[ -f "$BOOT_LOG" ]]; then
    cat "$BOOT_LOG"
fi
