#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
ROOT_DIR=$(cd "$SCRIPT_DIR/.." && pwd)
TMP_DIR=${TMP_DIR:-$ROOT_DIR/tmp}
PIWORK_NODE_VERSION=${PIWORK_NODE_VERSION:-20.11.1}
NODE_DIST="node-v${PIWORK_NODE_VERSION}-linux-arm64"
NODE_TARBALL="$TMP_DIR/${NODE_DIST}.tar.xz"
NODE_DIR=${PIWORK_NODE_DIR:-$TMP_DIR/runtime-node}
PI_DIR=${PIWORK_PI_DIR:-$TMP_DIR/runtime-pi}

mkdir -p "$TMP_DIR"

if ! command -v node >/dev/null 2>&1; then
    echo "Node.js is required on host to prepare the runtime pack." >&2
    exit 1
fi

PI_PACKAGE_JSON=$(node -e "console.log(require.resolve('@mariozechner/pi-coding-agent/package.json'))" 2>/dev/null || true)
if [[ -z "$PI_PACKAGE_JSON" ]]; then
    echo "@mariozechner/pi-coding-agent not found. Install with: npm install -g @mariozechner/pi-coding-agent" >&2
    exit 1
fi

PI_PACKAGE_DIR=$(dirname "$PI_PACKAGE_JSON")

rm -rf "$NODE_DIR" "$PI_DIR"
mkdir -p "$NODE_DIR" "$PI_DIR"

if [[ ! -f "$NODE_TARBALL" ]]; then
    echo "Downloading Node ${PIWORK_NODE_VERSION} for linux-arm64..."
    curl -L "https://nodejs.org/dist/v${PIWORK_NODE_VERSION}/${NODE_DIST}.tar.xz" -o "$NODE_TARBALL"
fi

rm -rf "$TMP_DIR/$NODE_DIST"
tar -xf "$NODE_TARBALL" -C "$TMP_DIR"
mv "$TMP_DIR/$NODE_DIST" "$NODE_DIR"

rsync -a "$PI_PACKAGE_DIR/" "$PI_DIR/"

rm -rf "$PI_DIR/node_modules/@mariozechner/clipboard" "$PI_DIR/node_modules/fsevents" "$PI_DIR/node_modules/.cache"

echo "Prepared Node runtime at: $NODE_DIR"
echo "Prepared pi package at: $PI_DIR"
