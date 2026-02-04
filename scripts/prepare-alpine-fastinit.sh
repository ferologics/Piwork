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

if [[ -n "${PIWORK_AUTH_PATH:-}" && -f "$PIWORK_AUTH_PATH" ]]; then
    mkdir -p "$FAST_DIR/opt/pi-agent"
    cp -f "$PIWORK_AUTH_PATH" "$FAST_DIR/opt/pi-agent/auth.json"
    chmod 600 "$FAST_DIR/opt/pi-agent/auth.json" || true
fi

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

if [ -f /opt/pi-agent/auth.json ]; then
    export PI_CODING_AGENT_DIR=/opt/pi-agent
fi

RPC_PORT=/dev/virtio-ports/piwork.rpc

setup_repos() {
    cat > /etc/apk/repositories <<'REPOS'
http://dl-cdn.alpinelinux.org/alpine/v3.23/main
http://dl-cdn.alpinelinux.org/alpine/v3.23/community
REPOS
}

emit_text() {
    local text="$1"
    printf '{"type":"message_update","assistantMessageEvent":{"type":"text_delta","contentIndex":0,"delta":"%s"}}\n' "$text" > "$RPC_PORT"
    printf '{"type":"message_update","assistantMessageEvent":{"type":"text_end","contentIndex":0,"content":"%s"}}\n' "$text" > "$RPC_PORT"
    printf '{"type":"message_update","assistantMessageEvent":{"type":"done","reason":"stop"}}\n' > "$RPC_PORT"
}

install_pi() {
    emit_text "Installing pi runtime..."
    setup_repos
    apk add --no-cache ca-certificates nodejs npm bash git
    update-ca-certificates 2>/dev/null || true
    npm install -g @mariozechner/pi-coding-agent --omit=optional
}

start_pi() {
    emit_text "Starting pi RPC..."
    echo READY > "$RPC_PORT"
    pi --mode rpc < "$RPC_PORT" > "$RPC_PORT" 2>/dev/null &
}

extract_json_field() {
    local input="$1"
    local field="$2"
    echo "$input" | sed -n "s/.*\"$field\":\"\([^\"]*\)\".*/\1/p"
}

rpc_loop() {
    local rpc_port="$1"
    local current_model_id="stub-model"
    local current_model_name="Stub Model"
    local current_model_provider="stub"

    while IFS= read -r line; do
        if echo "$line" | grep -q '"type":"get_state"'; then
            printf '{"type":"response","command":"get_state","success":true,"data":{"model":{"id":"%s","name":"%s","provider":"%s"},"sessionId":"stub-session","sessionName":"Stub Session","isStreaming":false}}\n' \
                "$current_model_id" "$current_model_name" "$current_model_provider" > "$rpc_port"
            continue
        fi

        if echo "$line" | grep -q '"type":"get_available_models"'; then
            printf '{"type":"response","command":"get_available_models","success":true,"data":{"models":[{"id":"%s","name":"%s","provider":"%s"}]}}\n' \
                "$current_model_id" "$current_model_name" "$current_model_provider" > "$rpc_port"
            continue
        fi

        if echo "$line" | grep -q '"type":"set_model"'; then
            local model_id
            local provider
            model_id=$(extract_json_field "$line" "modelId")
            provider=$(extract_json_field "$line" "provider")

            if [ -n "$model_id" ]; then
                current_model_id="$model_id"
                current_model_name="$model_id"
            fi

            if [ -n "$provider" ]; then
                current_model_provider="$provider"
            fi

            printf '{"type":"response","command":"set_model","success":true,"data":{"id":"%s","name":"%s","provider":"%s"}}\n' \
                "$current_model_id" "$current_model_name" "$current_model_provider" > "$rpc_port"
            continue
        fi

        if echo "$line" | grep -q '"type":"prompt"'; then
            echo '{"type":"response","command":"prompt","success":true}' > "$rpc_port"
            echo '{"type":"message_update","assistantMessageEvent":{"type":"text_delta","contentIndex":0,"delta":"Piwork stub: received prompt"}}' > "$rpc_port"
            echo '{"type":"message_update","assistantMessageEvent":{"type":"text_end","contentIndex":0,"content":"Piwork stub: received prompt"}}' > "$rpc_port"
            echo '{"type":"message_update","assistantMessageEvent":{"type":"done","reason":"stop"}}' > "$rpc_port"
            echo '{"type":"agent_end","reason":"completed"}' > "$rpc_port"
        else
            echo '{"type":"message_update","assistantMessageEvent":{"type":"text_delta","contentIndex":0,"delta":"Piwork stub: received command"}}' > "$rpc_port"
            echo '{"type":"message_update","assistantMessageEvent":{"type":"text_end","contentIndex":0,"content":"Piwork stub: received command"}}' > "$rpc_port"
            echo '{"type":"message_update","assistantMessageEvent":{"type":"done","reason":"stop"}}' > "$rpc_port"
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
            emit_text "pi install complete."
            start_pi
        else
            emit_text "Piwork stub: pi install failed"
            start_stub
        fi
    fi
else
    echo READY
fi

exec /usr/bin/sh -i
EOF

chmod +x "$FAST_DIR/init"

(
    cd "$FAST_DIR"
    find . -print0 | cpio --null -o -H newc | gzip -9 > "$INITRAMFS_FAST"
)
