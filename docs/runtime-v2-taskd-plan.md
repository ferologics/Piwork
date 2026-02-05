# Runtime v2 Plan — Task Supervisor (`taskd`) + Per-Task Users

## Why this pivot

The current runtime flow mixes multiple models:

- Shared VM
- Task-level session switching
- VM restarts on task/folder changes
- Fallback transcript → session hydration when mounts fail

This creates race conditions, UI spinner hangs, and unclear ownership of state.

## Goals

1. **No VM restart on task switch** (warm switch path)
2. **No fallback hydration hacks**
3. **Deterministic per-task resume** from canonical session files
4. **Task isolation inside VM** via process/user boundaries
5. **Predictable switch latency** (few seconds max)

## Non-goals (initial)

- Perfect cross-platform parity in first pass
- Full production-grade policy/ACL system in phase 1
- Solving every host↔guest file sync edge case in the first milestone

## Target architecture

### Host (Tauri)

- Maintains one connection to VM runtime service
- Sends task-scoped commands (`create_or_open_task`, `switch_task`, `prompt`, `get_state`)
- Stores task metadata and UI transcript cache (`conversation.json`)

### Guest (VM)

- New supervisor process: **`taskd`**
- Per task:
    - Linux user (e.g. `pw-<taskId>`)
    - Home directory: `/sessions/<taskId>`
    - Canonical session file: `/sessions/<taskId>/session.json`
    - Dedicated pi process running as that task user
- Task switch = supervisor switches active task process routing

## Data model (v2)

Per task in guest:

- `/sessions/<taskId>/session.json` (pi session; semantic truth)
- `/sessions/<taskId>/work/` (task workspace in guest, strategy below)

Per task on host:

- `task.json`
- `conversation.json` (UI cache only)

## Working folder strategy

Two viable options:

### Option A (recommended first): sync workspace

- Sync host working folder → guest `/sessions/<taskId>/work`
- Run task there
- Sync back on turn end / task switch / explicit save

Pros: simpler than live remount orchestration, avoids current mount fragility

### Option B (later): live shared mount

- Single long-lived shared mount + path-scoped access controls

Pros: live edits without sync
Cons: significantly more complexity and security hardening

## Phased implementation

## Phase 0 — Prep / guardrails

- Add runtime feature flag: `runtime_v2_taskd`
- Keep current path as fallback during migration
- Keep harness primitives (no monolithic e2e flow)

**Exit criteria:** both runtime paths can be selected explicitly.

## Phase 1 — Build `taskd` in guest

- Add supervisor RPC protocol:
    - `create_or_open_task(taskId, model, thinkingLevel, workingFolder?)`
    - `switch_task(taskId)`
    - `prompt(message)`
    - `get_state()`
    - `stop_task(taskId)` (optional first pass)
- Create per-task user/home on first open
- Launch one pi process per task as that user
- Wire stdout/stderr + RPC event forwarding through supervisor

**Exit criteria:** task switch no longer requires VM restart.

## Phase 2 — Host/UI integration

- Replace restart-on-task-switch flow with `switch_task`
- Remove transcript→session hydration from normal path
- Keep UI transcript save/load only as cache/visual state
- Enforce short switch and readiness timeouts

**Exit criteria:** no spinner hangs during normal task switch.

## Phase 3 — Folder access model

- Implement Option A sync workspace first
- Define explicit sync moments (before prompt, after turn, on switch)
- Track conflicts and surface simple recovery path

**Exit criteria:** task-local files remain isolated and survive restarts.

## Phase 4 — Hardening

- Permissions: task homes `0700`
- Ensure task users cannot read sibling task dirs
- Add cleanup policy (TTL/archive/reap)
- Improve observability (taskd logs + per-task status in test harness)

**Exit criteria:** reliable isolation and predictable operations over long sessions.

## Phase 5 — Remove v1 slop

- Delete fallback hydration path
- Delete VM restart on task-switch codepath
- Remove outdated docs and tasks tied to v1 behavior

**Exit criteria:** single clean runtime model in code and docs.

## Testing plan

Use primitive harness commands only:

- Create Task A, seed memory, create Task B, seed memory
- Switch back/forth repeatedly without VM restart
- Ask semantic recall questions per task
- Capture state + screenshot + logs for each claim

Required checks:

- No cross-task memory bleed
- No long-running spinner on switch
- Resume remains correct after app restart

## Risks / open questions

1. Process lifecycle complexity for many idle tasks
2. Cost of workspace sync for large folders (if using Option A)
3. How to expose/limit network and connectors per task user
4. Whether we eventually adopt virtiofs instead of 9p

## Immediate next actions

1. Define `taskd` RPC message schema
2. Implement minimal supervisor with one task process
3. Wire host to `switch_task` under feature flag
4. Prove warm-switch semantics with harness evidence
