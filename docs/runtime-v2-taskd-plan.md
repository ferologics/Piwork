# Runtime v2 Plan — Task Supervisor (`taskd`) + Staged Workspace Strategy

## Why this pivot

The current runtime flow mixes multiple models:

- Shared VM
- Task-level session switching
- VM restarts on task/folder changes
- Fallback transcript → session hydration when mounts fail

This causes race conditions, spinner hangs, and unclear ownership of task state.

## Goals

1. **No VM restart on task switch** (warm switch)
2. **No transcript hydration fallback in normal path**
3. **Deterministic per-task resume** from canonical session files
4. **Predictable switch latency** (few seconds max)
5. **Lower orchestration complexity in UI** (`MainView` no longer owns runtime state machine)

## Non-goals (initial)

- Perfect cross-platform parity in first pass
- Full production-grade policy/ACL system in phase 1
- Final strict-network MITM policy in v2 core

## Locked decisions (now)

- Runtime rollout is split by feature flags:
  - `runtime_v2_taskd` (task lifecycle/switch/prompt)
  - `runtime_v2_sync` (workspace sync)
- `stop_task` is **required early** (not optional)
- Extract host orchestration out of `MainView.svelte` **before** taskd integration
- Defer per-task Linux users to hardening; start with process isolation
- Add explicit workspace decision gate after host+taskd warm switch works

## Target architecture

### Host (Tauri)

- VM transport owner stays in backend runtime layer
- New host runtime service handles:
  - task switch orchestration
  - timeout handling
  - (later) sync orchestration
- UI renders typed runtime state/events and sends intents

### Guest (VM)

- `init` remains PID 1
- `init` launches long-lived **`taskd`** process (Node.js first pass)
- `taskd` supervises one pi process per task
- Baseline isolation: per-task process + per-task session/work directories
- Per-task OS user isolation is deferred to hardening

Per task in guest:

- `/sessions/<taskId>/session.json` (canonical semantic truth)
- `/sessions/<taskId>/work/` (workspace in guest)

Per task on host:

- `task.json`
- `conversation.json` (UI cache only)

## Runtime contract (baseline)

### Task lifecycle state machine

`missing -> creating -> ready -> active -> idle -> errored -> stopped`

### Allowed RPCs by state

- `create_or_open_task`: valid from `missing`, `stopped`, `errored`
- `switch_task`: valid for target in `ready` or `idle`
- `prompt`: valid only when exactly one task is `active`
- `stop_task`: valid from `ready`, `active`, `idle`, `errored`

### Baseline RPC surface

- `create_or_open_task(taskId, model, thinkingLevel, workingFolder?)`
- `switch_task(taskId)`
- `prompt(message)`
- `get_state()`
- `stop_task(taskId)`

Companion wire contract (P0 normative): `docs/runtime-v2-taskd-rpc-spec.md`

### Event stream (minimum)

- `task_switch_started(taskId)`
- `task_ready(taskId)`
- `task_error(taskId, code, message)`
- `task_stopped(taskId)`
- `agent_output(taskId, chunk)`
- `agent_end(taskId, usage?)`

### `switch_task` semantics

- `switch_task` returns quick ACK (`status: "switching"`)
- Host waits for `task_ready`
- Host applies hard timeout (start with 5s)
- On timeout: deterministic UI exit + `SWITCH_TIMEOUT`

Latency targets (initial budgets):

- **Warm switch** (`idle/ready -> active`): target p95 `< 1s` to `task_ready`
- **Cold resume** (reaped/stopped -> ready): target p95 `< 3s` to `task_ready`

### `create_or_open_task` semantics

Response includes mode to avoid ambiguity:

- `mode: "created"` (new task)
- `mode: "resumed"` (stopped -> ready)
- `mode: "recovered"` (errored -> relaunched)

### Canonical session durability and crash semantics

- `session.json` is canonical semantic truth
- Persist atomically (`session.tmp` + rename) on completed turn (`agent_end`)
- If pi crashes mid-turn before flush, last in-flight turn may be lost (accepted in v2)
- `taskd` detects child exit, marks task `errored`, emits `task_error` (`PI_PROCESS_DEAD`)

## Workspace strategy (decision gate)

### Gate G1 (after host+taskd warm switch is stable)

Run a focused spike and choose one path:

- **Path M (live mount path):** if stable and deterministic with harness evidence
- **Path S (sync path / Option A):** if live mount remains fragile or operationally complex

### Gate G1 outcome (2026-02-06): **Path S selected**

Spike evidence:

- VM boot log shows no active working-folder mount in v2 taskd test boots (`No working folder mounted`).
- v2 folder changes are metadata-only in host path (no remount/restart on change).
- In-guest mount check after folder changes (`grep ' /mnt/workdir ' /proc/mounts`) remained negative.
- Task switch path is stable without VM restarts, so sync can be layered without reintroducing restart coupling.

Decision: proceed with **Path S** and defer Path M.

Decision criteria (for reference):

- No VM restart required for folder/task switching
- No mount/switch spinner hangs in repeated loops
- Resume correctness remains intact after restart
- Warm switch p95 stays within target (`< 1s`)
- Cold resume p95 stays within target (`< 3s`)

### Path S — Option A sync (selected)

Protocol details are tracked in `docs/runtime-v2-taskd-sync-spec.md`.

Sync moments:

1. Before prompt: host → guest
2. After turn: guest → host
3. On switch away: best-effort guest → host flush
4. On switch to task: host → guest refresh

Conflict behavior (first pass):

- file-level divergence detection
- preserve both versions (suffix)
- emit `SYNC_CONFLICT`
- keep task usable

## Security invariants (scope now vs later)

### Mandatory in early rollout (cheap, high-value)

- Host-authoritative workspace root per task
- Reject absolute paths / `..` traversal / invalid path bytes
- No symlink follow
- Reject special files (device/socket/fifo/hardlink cases)

### Later (only when sync apply is enabled)

- Operation budgets (files/bytes/max file size)
- Content hash verification for sync writes/reads
- Full sync audit trail and conflict telemetry

Policy violation behavior:

- emit `SYNC_POLICY_VIOLATION`
- abort affected sync unit
- keep task alive and recoverable

## Network policy roadmap

- v2 baseline: NAT + existing connector/tool gating
- strict host-mediated network policy (MITM/hooks model) is post-v2
- reference direction: Gondolin-like host `http-hooks`, gated behind future mode

## Execution plan

### Phase 0a — Host orchestration extraction (standalone)

- Introduce `src/lib/services/runtimeService.ts` (or equivalent TS service) as the orchestration owner for protocol/state transitions
- Keep `src-tauri/src/vm.rs` focused on VM lifecycle + transport only
- Move runtime orchestration out of `MainView.svelte` into the service layer
- Keep behavior unchanged

**Exit criteria:** `MainView` is UI orchestration only; no new protocol timers/maps added there.

### Phase 0 — Flags and guardrails

- Add `runtime_v2_taskd` and `runtime_v2_sync`
- Keep v1 path selectable
- Keep primitive harness workflow only

**Exit criteria:** v1/v2-taskd selectable; sync independently toggleable.

### Phase 1 — Minimal `taskd` core (no sync)

- Implement `create_or_open_task`, `switch_task`, `prompt`, `get_state`, `stop_task`
- One pi process per task
- Per-task session/work dirs
- Emit baseline task/agent events

**Exit criteria:** warm switch works in guest without VM restart.

### Phase 2 — Host integration (no sync)

- Wire host service/UI to taskd switch ACK + ready event
- Enforce timeout and deterministic spinner exit
- Remove hydration fallback from normal v2 path

**Exit criteria:** no spinner hangs in normal task switching.

### Gate G1 — Workspace strategy decision

- ✅ Mount viability spike run with harness evidence
- ✅ Path S selected (live-mount path deferred)

### Phase 3M — Live mount path (deferred)

- Deferred by Gate G1 outcome.

### Phase 3S — Sync path (active)

- `runtime_v2_sync` dry-run first (manifest + conflict reporting)
- then enable sync apply

**Exit criteria:** stable sync around prompts/switches with conflict recovery.

### Phase 4 — Hardening

- Reaping policy (max warm tasks + LRU)
- Better observability (`taskd` + host service metrics/logs)
- Optional per-task Linux users (`0700` homes) if still needed

**Exit criteria:** predictable long-session behavior and bounded resource growth.

### Phase 5 — Remove v1 slop

- Delete VM-restart-on-task-switch path
- Delete transcript hydration fallback path
- Remove obsolete docs/tasks

**Exit criteria:** one clean runtime model in code/docs.

## Testing plan

Use primitive harness commands only.

Core checks:

- No cross-task memory bleed
- No long-running spinner on switch
- `task_switch_started -> task_ready` within timeout budget
- Resume remains correct after app restart

Security checks (when sync path is active):

- Path-escape attempt blocked (`SYNC_POLICY_VIOLATION`)
- Symlink-escape attempt blocked (`SYNC_POLICY_VIOLATION`)
- Conflict case preserves both versions

Resource/reaping checks:

- With warm cap N, creating N+1 active tasks reaps LRU idle task
- Reaped task can be cold-resumed via `create_or_open_task`
- Warm switch p95 `< 1s` and cold resume p95 `< 3s` (captured in logs)

Evidence requirement for claims:

1. `test-dump-state`
2. `test-screenshot <name>`
3. relevant log lines as supporting evidence

## Risks / open questions

1. `taskd` process supervision edge cases (child lifecycle under load)
2. Sync cost for large workspaces (Path S)
3. Conflict UX quality when apply mode lands (`SYNC_CONFLICT` ergonomics)
4. Network-control scope creep vs core v2 delivery
5. Whether per-task Linux users are worth complexity after baseline stabilizes

## Progress snapshot (2026-02-06)

Completed in code:

- ✅ Phase 0a extraction: runtime orchestration moved from `MainView.svelte` into `src/lib/services/runtimeService.ts`.
- ✅ Phase 0 flags/guardrails:
  - Added host runtime flags (`runtime_v2_taskd`, `runtime_v2_sync`) via `runtime_flags` command.
  - v1/v2-taskd mode is selectable.
  - `runtime_v2_sync` is guarded behind `runtime_v2_taskd`.
- ✅ Harness observability update: `test-dump-state` now logs `mode`, `taskd`, and `sync`.
- ✅ Phase 1 guest `taskd` core (no sync):
  - Added `/opt/piwork/taskd.js` supervisor in runtime pack (Node process-per-task model).
  - Implemented P0 task RPCs in guest: `create_or_open_task`, `switch_task`, `prompt`, `get_state`, `stop_task`.
  - Added baseline task events (`task_switch_started`, `task_ready`, `task_error`, `task_stopped`, `agent_output`, `agent_end`).
  - Added runtime boot mode switch via kernel cmdline (`piwork.runtime_mode=taskd`) behind `runtime_v2_taskd`.
- ✅ Phase 2 host integration (no sync):
  - Replaced v2 compatibility adapter with real taskd RPC routing for switch/prompt.
  - Implemented host-side switch handshake (`switch_task` ACK + wait for `task_ready` event with timeout handling).
  - Removed normal-path v2 dependence on VM restart + transcript hydration fallback.
  - Kept v1 restart/hydration path intact behind `mode=v1`.
- ✅ Initial latency proof (harness sample):
  - Warm-switch loop and cold-resume loop executed in `runtime_v2_taskd` mode.
  - Measured (`task_switch_started -> task_ready`) sample p95:
    - warm: ~0.45ms
    - cold resume: ~0.60ms
  - Captured required evidence: `test-dump-state`, `test-screenshot phase2-latency`, supporting log lines.
  - Verified no VM restart during switch loops (`[rust:vm] start called` count remained 1).
- ✅ Gate G1 decision: Path S selected.
  - Harness spike showed v2 folder changes are metadata-only and `/mnt/workdir` is not dynamically mounted/switched.
  - Proceeding with sync-first workspace path (Phase 3S).

Still open:

- ⏳ Phase 3S sync protocol + dry-run/apply implementation.
- ⏳ Focused resume-semantics checks (task-local memory seed test, no cross-task bleed assertions).

## Immediate next actions

1. Implement `runtime_v2_sync` dry-run plumbing (manifest + conflict reporting, no apply)
2. Add focused resume-semantics checks (task-local memory seed test, no cross-task bleed assertions)
3. Add sync observability in harness (`test-dump-state` + sync event capture)
