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

if [[ -z "${PIWORK_AUTH_PATH:-}" && -n "${PIWORK_COPY_AUTH:-}" ]]; then
    AUTH_PROFILE=${PIWORK_AUTH_PROFILE:-default}

    if [[ "$(uname -s)" == "Darwin" ]]; then
        APP_AUTH_CANDIDATE="$HOME/Library/Application Support/com.pi.work/auth/$AUTH_PROFILE/auth.json"
    elif [[ -n "${XDG_DATA_HOME:-}" ]]; then
        APP_AUTH_CANDIDATE="$XDG_DATA_HOME/piwork/auth/$AUTH_PROFILE/auth.json"
    elif [[ -n "${APPDATA:-}" ]]; then
        APP_AUTH_CANDIDATE="$APPDATA/com.pi.work/auth/$AUTH_PROFILE/auth.json"
    else
        APP_AUTH_CANDIDATE="$HOME/.local/share/piwork/auth/$AUTH_PROFILE/auth.json"
    fi

    if [[ -f "$APP_AUTH_CANDIDATE" ]]; then
        export PIWORK_AUTH_PATH="$APP_AUTH_CANDIDATE"
    else
        AUTH_CANDIDATE="$HOME/.pi/agent/auth.json"
        if [[ -f "$AUTH_CANDIDATE" ]]; then
            export PIWORK_AUTH_PATH="$AUTH_CANDIDATE"
        fi
    fi
fi

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

if [[ -n "${PIWORK_AUTH_PATH:-}" ]]; then
    echo "Included auth.json from: $PIWORK_AUTH_PATH"
fi

echo "Runtime pack installed at: $RUNTIME_DIR"
