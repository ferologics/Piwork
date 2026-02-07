# pi Integration Quick Reference (Host ↔ VM ↔ taskd)

Status: active
Category: canonical
Owner: runtime/platform
Last reviewed: 2026-02-07

Use this as a concise integration map. The runtime narrative lives in:

- `docs/runtime-taskd-plan.md` (primary runtime architecture + rollout)
- `docs/runtime-taskd-rpc-spec.md` (normative RPC contract)

## Runtime topology

- Host (Tauri) starts/stops VM and owns RPC transport.
- VM init (`runtime/init.sh`) mounts shares and starts `runtime/taskd.js`.
- taskd supervises one pi process per task.
- Frontend runtime orchestration lives in `src/lib/services/runtimeService.ts`.

## Transport + protocol

- Host reaches taskd at `localhost:19384` (QEMU `hostfwd`).
- Host commands use strict envelopes:
  - request: `{ id, type, payload }`
  - response: `{ id, ok, result | error }`
- Event stream payloads are forwarded separately from command responses.

See full command/event/error definitions in `docs/runtime-taskd-rpc-spec.md`.

## Mounts + per-task paths

- `workdir` → `/mnt/workdir` (user workspace)
- `taskstate` → `/mnt/taskstate` (task artifacts + sessions)
- `authstate` → `/mnt/authstate` (default auth profile)

Per task:

- canonical session: `/sessions/<taskId>/session.json`
- writable artifacts: `/mnt/taskstate/<taskId>/outputs`
- read-only uploads: `/mnt/taskstate/<taskId>/uploads`

## Working-folder + scope contract

- `workingFolder` is one-time bind (`null -> path`), then locked per task.
- Host validates scope before task creation/open.
- Guest enforces relative path constraints and rejects traversal/symlink escapes.
- Scoped-policy smoke suite entrypoint: `mise run test-scope-negative`.

## Persistence model

Host:

- `task.json` (task metadata)
- `conversation.json` (UI cache)

Guest canonical semantic state:

- `/sessions/<taskId>/session.json`

## Testing + evidence

- Test strategy: `docs/testing-strategy.md`
- For runtime behavior claims, capture:
  1. `mise run test-dump-state`
  2. `mise run test-screenshot <name>`
  3. relevant logs (`tmp/dev/piwork.log`)
