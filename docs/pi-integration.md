# pi Integration (Host ↔ VM ↔ taskd)

## Overview

pi runs inside the VM and is orchestrated by the host app over RPC.

Runtime model is now single-path:

- taskd runtime (active baseline)
- no legacy runtime mode split

## Process architecture (current)

Host (Tauri app):

- launches QEMU
- manages VM lifecycle and RPC transport
- persists task metadata + conversation cache
- orchestrates task switch and prompt routing via `RuntimeService`

Guest (VM):

- init script boots runtime
- starts `taskd`
- `taskd` supervises one pi process per task

Per task (guest):

- session file: `/sessions/<taskId>/session.json` (canonical)
- workspace dir: `/sessions/<taskId>/work`

## RPC transport (current)

- QEMU user-mode networking + `hostfwd` exposes TCP `19384`
- host sends/receives JSONL RPC through `localhost:19384`
- host sends taskd command envelope:
  - request `{ id, type, payload }`
  - response `{ id, ok, result|error }`

Normative command/event details: `runtime-taskd-rpc-spec.md`.

## Runtime behavior (current)

- no normal-path VM restart on task switch
- host switch flow: `switch_task` ACK (`status: switching`) + wait for `task_ready`
- deterministic timeout/error handling in host runtime service
- no normal-path transcript hydration fallback
- infra shell actions should use `system_bash` (taskd lane), not pi session flows

## Working folder and scope model (Path I-lite)

Current MVP direction is Path I-lite:

- host validates working folder against workspace root (`realpath` + scope checks)
- host passes validated relative path to guest task creation
- guest enforces relative-path constraints for task cwd selection
- changing the active task folder applies immediately by recycling that task process (`stop_task` → `create_or_open_task` → `switch_task`) without VM restart
- when workspace root is unavailable in-guest, taskd falls back to task scratch workspace (`/sessions/<taskId>/work`) instead of failing hard
- task session continuity is preserved across folder changes via the same task `session.json`
- runtime mount reliability is maintained by loading required 9p modules before mount attempts

## Task persistence

Host persists:

- `task.json` (metadata)
- `conversation.json` (UI cache)

Guest canonical semantic state:

- `/sessions/<taskId>/session.json`

## Testing hooks

Automated harness drives UI state via dev test server (`127.0.0.1:19385`) commands:

- set folder/task
- create/delete tasks
- send prompt
- dump state

Evidence requirement for runtime claims:

1. `test-dump-state`
2. `test-screenshot <name>`
3. supporting logs
