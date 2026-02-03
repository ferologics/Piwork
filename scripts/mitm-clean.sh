#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
ROOT_DIR=$(cd "$SCRIPT_DIR/.." && pwd)
TMP_DIR=${TMP_DIR:-$ROOT_DIR/tmp}

rm -f "$TMP_DIR/piwork-netdev.sock" \
    "$TMP_DIR/mitm-netdev.log" \
    "$TMP_DIR/mitm-qemu.log" \
    "$TMP_DIR/mitm-boot.log"

if [[ "${CLEAN_ISO:-0}" == "1" ]]; then
    rm -f "$TMP_DIR/alpine-virt-3.23.3-aarch64.iso"
fi
