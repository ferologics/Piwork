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

## RPC Transport

- QEMU exposes a **virtio‑serial** channel.
- pi runs `--mode rpc` and listens on `/dev/virtio-ports/piwork.rpc`.
- Host reads/writes **JSONL** over this stream (same as stdin/stdout).
- Dev runtime currently attempts a boot-time `apk` + `npm` install of pi and falls back to stub JSONL replies if install fails.

## Task Model

- **One VM per task** (fresh overlay per task).
- Host starts pi → sends `prompt` commands.
- Host **stores task metadata + transcript** (pi session files used for resume).

## Event Mapping (RPC → UI)

- `message_update` → streaming transcript
- `tool_execution_*` → progress steps + logs
- `extension_ui_request` → permission prompts
- `agent_end` → mark task complete + highlight artifacts

## Task Persistence / Resume (v1)

**Task metadata stored on host:**

- `task.json`:
  - `taskId`, `title`, `status`, `createdAt`, `updatedAt`
  - `sessionFile` (pi session JSONL path)
  - `mounts` (approved folders + modes)
  - `model` + `thinkingLevel`
  - `connectorsEnabled`

**Resume flow:**

1. Start a **fresh VM**.
2. Mount the same folders listed in `task.json`.
3. Mount host `auth.json` for provider access.
4. Start pi with `--session-dir` pointing at the host‑mounted tasks dir.
5. Call `switch_session` with `sessionFile`.
6. Rebuild UI via `get_messages` + `get_state`.

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
