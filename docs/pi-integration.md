# pi Integration (RPC + Permission Gate)

## Overview

pi runs **inside the VM** and is controlled by the host app via **RPC mode**. The host UI renders all events (streaming output, tool calls, permission prompts) and stores task state.

## Process Architecture

```
Host UI (Tauri)
  ├─ runtime pack manager
  ├─ QEMU launcher
  ├─ RPC bridge (virtio‑serial)
  ├─ policy store (permissions)
  └─ task store (UI state)

VM (Linux)
  ├─ pi CLI (RPC mode)
  ├─ permission‑gate extension
  └─ skills/tools
```

## RPC Transport (current)

- QEMU uses **user-mode NAT** with `hostfwd` to expose TCP port `19384`.
- pi runs `--mode rpc`, wired via `nc -l -p 19384 -e node pi --mode rpc` inside the VM.
- Host reads/writes **JSONL** over TCP `localhost:19384`.
- Dev runtime prebakes Node + pi into the initramfs (no boot-time installs).
- Host logs QEMU stderr to `app_data/vm/qemu.log` for debugging failed boots.
- If `PIWORK_AUTH_PATH` was provided at pack install time, the initramfs sets `PI_CODING_AGENT_DIR=/opt/pi-agent` to use the baked `auth.json`.

> **Future**: move to virtio‑serial once stable.

## Task Model (current)

- **Single shared VM** across tasks (restarted on task/folder switch).
- Host starts pi → sends `prompt` commands.
- Host stores task metadata + transcript and mounts the active task directory for pi session persistence.

## Event Mapping (RPC → UI)

- `message_update` → streaming transcript
- `tool_execution_*` → progress steps + logs
- `extension_ui_request` → permission prompts
- `agent_end` → mark task complete + highlight artifacts

## Task Persistence / Resume (current)

**Task metadata stored on host:**

- `task.json`:
  - `taskId`, `title`, `status`, `createdAt`, `updatedAt`
  - `workingFolder` (optional)
  - `model` (selected)

**Resume flow (current):**

1. UI loads `conversation.json` from task folder.
2. VM is restarted with the active task directory mounted at `/mnt/taskstate`.
3. Host passes `piwork.session_file=/mnt/taskstate/session.json` via kernel cmdline.
4. Init script starts pi with `--session /mnt/taskstate/session.json`.
5. If the file exists, pi resumes automatically; otherwise it creates a new session file in the task folder.

**Session isolation (current):**

- VM only mounts the **active task state directory** (not the whole tasks root).
- pi session file is canonical per task: `/mnt/taskstate/session.json`.
- Task switching remounts paths by restarting the shared VM.

## Permission Gate Extension

A pi extension inside the VM enforces action prompts using `tool_call` interception.

### Flow

1. pi emits `tool_call` event.
2. Extension checks action type (write/edit/delete/network/connector).
3. Extension calls `ctx.ui.select/confirm`.
4. In RPC mode, this emits `extension_ui_request` to host.
5. Host shows modal **or auto‑responds** if policy says “Always allow”.
6. Extension receives response and returns `{ block: true }` if denied.

### Why host‑side policy

- VM is ephemeral; policy must persist on host.
- Host can **auto‑respond** to `extension_ui_request` without showing UI.

## Permission Types (v1)

- **Write/Edit** → no prompt inside scope; track changes list
- **Delete/Move/Rename** → prompt (always)
- **Web search** → no prompt, but visible connector badge + drill‑in
- **Other connectors** → prompt on first use

## Skills / Tools

- Built‑ins: `read`, `write`, `edit`, `bash`, `ls`, `find`, `grep`
- Web search: include a **search skill** in runtime pack
- Custom tools/extensions can be bundled in runtime pack

## Settings in VM

- Provide a minimal `settings.json` that:
  - Loads the permission‑gate extension
  - Enables default tools/skills
  - Sets model defaults (if needed)
- Mount host `~/.pi/agent/auth.json` into the VM during dev

## Open Questions

- Should we **cache model auth** inside the VM or proxy from host?
- Do we want a **read‑only mode** toggle for tasks?
- Should tasks be resumable via replayed transcript?
