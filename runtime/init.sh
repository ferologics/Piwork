#!/bin/sh
export PATH=/usr/local/bin:/usr/bin:/bin:/sbin
export LD_LIBRARY_PATH=/usr/lib
export NODE_PATH=/opt/pi/node_modules
export PI_PACKAGE_DIR=/opt/pi
RPC_PORT=19384
WORKDIR=/mnt/workdir
TASK_STATE_DIR=/mnt/taskstate
AUTH_STATE_DIR=/mnt/authstate
TASK_STATE_MOUNTED=0
AUTH_STATE_MOUNTED=0
SESSIONS_ROOT=""
TASKS_ROOT=""
INITIAL_TASK_ID=""

wait_for_taskd_port() {
    PORT_HEX=$(printf '%04X' "$RPC_PORT")
    ATTEMPT=0

    while [ "$ATTEMPT" -lt 50 ]; do
        if grep -qi ":$PORT_HEX " /proc/net/tcp 2>/dev/null; then
            return 0
        fi

        sleep 0.1
        ATTEMPT=$((ATTEMPT + 1))
    done

    return 1
}

mount -t proc proc /proc
mount -t sysfs sysfs /sys
mount -t devtmpfs dev /dev
mount -t tmpfs tmpfs /run

modprobe virtio_pci 2>/dev/null || true
modprobe virtio_net 2>/dev/null || true
modprobe netfs 2>/dev/null || true
modprobe 9pnet 2>/dev/null || true
modprobe 9pnet_virtio 2>/dev/null || true
modprobe 9p 2>/dev/null || true

if ! grep -q $'\t9p$' /proc/filesystems 2>/dev/null; then
    KVER=$(uname -r)
    MODROOT="/usr/lib/modules/$KVER/kernel"
    insmod "$MODROOT/fs/netfs/netfs.ko" 2>/dev/null || true
    insmod "$MODROOT/net/9p/9pnet.ko" 2>/dev/null || true
    insmod "$MODROOT/net/9p/9pnet_virtio.ko" 2>/dev/null || true
    insmod "$MODROOT/fs/9p/9p.ko" 2>/dev/null || true
fi

for arg in $(cat /proc/cmdline); do
    case "$arg" in
        piwork.sessions_root=*)
            SESSIONS_ROOT="${arg#piwork.sessions_root=}"
            ;;
        piwork.task_id=*)
            INITIAL_TASK_ID="${arg#piwork.task_id=}"
            ;;
    esac
done

ip link set eth0 up
udhcpc -i eth0 -q -n -t 3 -T 1

# QEMU user-mode networking provides DNS at 10.0.2.3
echo "nameserver 10.0.2.3" > /etc/resolv.conf

# Mount working folder if available (9p virtio share)
mkdir -p "$WORKDIR"
if mount -t 9p -o trans=virtio,version=9p2000.L workdir "$WORKDIR"; then
    echo "Mounted working folder at $WORKDIR"
    export PI_WORKING_DIR="$WORKDIR"
    export PIWORK_WORKSPACE_ROOT="$WORKDIR"
    cd "$WORKDIR"
else
    echo "No working folder mounted"
fi

# Mount task state folder if available (9p virtio share)
mkdir -p "$TASK_STATE_DIR"
if mount -t 9p -o trans=virtio,version=9p2000.L taskstate "$TASK_STATE_DIR"; then
    TASK_STATE_MOUNTED=1
    echo "Mounted task state at $TASK_STATE_DIR"
else
    echo "No task state mounted"
fi

# Mount auth state folder if available (9p virtio share)
mkdir -p "$AUTH_STATE_DIR"
if mount -t 9p -o trans=virtio,version=9p2000.L authstate "$AUTH_STATE_DIR"; then
    AUTH_STATE_MOUNTED=1
    echo "Mounted auth state at $AUTH_STATE_DIR"
else
    echo "No auth state mounted"
fi

if [ -z "$SESSIONS_ROOT" ]; then
    if [ "$TASK_STATE_MOUNTED" = "1" ]; then
        SESSIONS_ROOT="$TASK_STATE_DIR/sessions"
    else
        SESSIONS_ROOT="/sessions"
    fi
fi

TASKS_ROOT="${SESSIONS_ROOT%/*}"
if [ -z "$TASKS_ROOT" ]; then
    TASKS_ROOT="/"
fi

if [ "$AUTH_STATE_MOUNTED" = "1" ] && [ -f "$AUTH_STATE_DIR/default/auth.json" ]; then
    export PI_CODING_AGENT_DIR="$AUTH_STATE_DIR/default"
    echo "Using mounted auth profile: default"
fi

if [ -z "${PI_CODING_AGENT_DIR:-}" ] && [ -f /opt/pi-agent/auth.json ]; then
    export PI_CODING_AGENT_DIR=/opt/pi-agent
    echo "Using baked auth at /opt/pi-agent"
fi

[ -f /opt/pi-agent/env.sh ] && . /opt/pi-agent/env.sh

if [ -x /usr/bin/node ] && [ -f /opt/pi/dist/cli.js ] && [ -f /opt/piwork/taskd.js ]; then
    mkdir -p "$SESSIONS_ROOT" "$TASKS_ROOT"
    export PIWORK_RPC_PORT="$RPC_PORT"
    export PIWORK_PI_CLI=/opt/pi/dist/cli.js
    export PIWORK_TASKD_SESSIONS_ROOT="$SESSIONS_ROOT"
    export PIWORK_TASKD_TASKS_ROOT="$TASKS_ROOT"
    [ -n "$INITIAL_TASK_ID" ] && export PIWORK_INITIAL_TASK_ID="$INITIAL_TASK_ID"

    echo "Runtime: taskd"
    echo "Taskd sessions root: $SESSIONS_ROOT"
    echo "Taskd tasks root: $TASKS_ROOT"

    /usr/bin/node /opt/piwork/taskd.js 2>&1 &

    if wait_for_taskd_port; then
        echo "READY"
    else
        echo "ERROR: taskd RPC port did not become ready"
    fi
else
    echo "ERROR: taskd runtime dependencies missing"
fi

exec /bin/sh -i
