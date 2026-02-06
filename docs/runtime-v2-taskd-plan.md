# Runtime v2 Plan — Task Supervisor (`taskd`) + Staged Workspace Strategy

> **Status update (2026-02-06):** Phase 0–2 remains the active baseline and is complete in code. Execution is now on **Path I-lite** for MVP (strict scope enforcement on current runtime, no sync expansion). Path G (Gondolin) stays as research lane via Gate G2. Path S (sync-first) is draft fallback only.

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
  - `runtime_v2_sync` (reserved for experimental sync path; not currently the default direction)
- `stop_task` is **required early** (not optional)
- Extract host orchestration out of `MainView.svelte` **before** taskd integration
- Execute Path I-lite for MVP before deeper sandbox rewrites
- Add explicit workspace/sandbox decision gate for post-MVP hardening (Gate G2)
- No further sync-heavy implementation unless Path S is explicitly re-selected

## Target architecture

### Host (Tauri)

- VM transport owner stays in backend runtime layer
- New host runtime service handles:
  - task switch orchestration
  - timeout handling
  - (later) workspace/sandbox orchestration (path TBD by Gate G2)
- UI renders typed runtime state/events and sends intents

### Guest (VM)

- `init` remains PID 1
- `init` launches long-lived **`taskd`** process (Node.js first pass)
- `taskd` supervises one pi process per task
- Baseline isolation: per-task process + per-task session/work directories
- Per-task OS user + sandbox boundary is under active evaluation (Gate G2)

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

## Workspace + sandbox strategy (decision gates)

### Gate G1 (historical)

Original Gate G1 compared live-mount vs sync-first and recorded **Path S**.
That outcome is now treated as **provisional**: subsequent review concluded the evidence was not sufficient to reject mount-based approaches (the v2 mount path had not been fully wired at the time).

### Gate G2 (active): architecture reassessment

Detailed spike checklist: `docs/runtime-g2-architecture-spike.md`.

Before shipping more Phase 3 work, choose one direction:

- **Path I (isolation-first on current runtime):**
  - scoped workspace-root mount (no broad home mount)
  - strict task-folder scope checks
  - per-task Linux user and staged sandbox hardening
- **Path G (Gondolin-based runtime):**
  - evaluate adopting Gondolin for programmable VFS/network controls and isolation primitives
  - integrate with pi RPC + current task model
- **Path S (sync-first):**
  - keep as fallback draft only
  - not the default path while G2 is unresolved

Decision criteria:

- No VM restart on task/folder switching
- Enforceable task file scope (not just convention via cwd)
- No cross-task data bleed
- Acceptable latency/UX for prompt + task switching
- Integration complexity is feasible for current team/stage

Required G2 evidence:

1. `test-dump-state`
2. `test-screenshot <name>`
3. supporting runtime logs
4. short ADR documenting chosen path + deferred hardening

## Security invariants (scope now vs later)

### Mandatory in early rollout (cheap, high-value)

- Host-authoritative workspace root per task
- Reject absolute paths / `..` traversal / invalid path bytes
- No symlink follow for scoped writes
- Reject special files (device/socket/fifo/hardlink cases)

### Next hardening tranche (after G2 direction is chosen)

- Per-task Linux users with strict ownership on task state dirs
- Sandbox boundary for task process (filesystem allowlist and privilege drop)
- Operation budgets and audit telemetry for potentially destructive flows

Policy violation behavior:

- emit deterministic policy error event
- abort affected operation
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

### Gate G1 — Workspace strategy decision (historical)

- ✅ Initial spike and documentation completed
- ⚠️ Outcome (Path S) is now provisional and reopened under Gate G2

### Phase 3I-lite — MVP isolation execution track (active)

- Enforce scoped folder access with host+guest path checks (`realpath`, traversal/symlink/special-file guards)
- Add negative tests for escape attempts + cross-task bleed checks
- Keep current no-restart switching and taskd lifecycle behavior
- Keep security copy honest: scoped local mode, not fully hardened hostile-code sandbox

**Exit criteria:** enforceable scoped writes in normal flows without regressions in switch/prompt UX.

### Gate G2 — Runtime/sandbox architecture decision (research, non-blocking)

- Run focused spikes:
  - deeper isolation hardening on current runtime (per-task users + stronger sandbox)
  - Gondolin feasibility path (pi RPC + scoped filesystem + switch UX)
- Compare using shared acceptance criteria (scope enforcement, latency, implementation cost)

**Exit criteria:** explicit architecture decision record with selected post-MVP path and deferred items.

### Phase 3G — Gondolin integration (if Path G selected)

- Bridge Tauri host to Gondolin VM lifecycle
- Run pi RPC inside Gondolin guest
- Map task model/session semantics to existing UI/runtime service

### Phase 3S — Sync path (on hold fallback)

- Keep draft protocol/docs
- No additional implementation unless explicitly re-selected

### Phase 4 — Hardening

- Reaping policy (max warm tasks + LRU)
- Better observability (`taskd` + host service metrics/logs)
- Stronger isolation boundary based on selected path

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

Security checks (for selected path):

- Path-escape attempt blocked (deterministic policy error)
- Symlink-escape attempt blocked
- Cross-task file visibility/write denied
- If sync path is selected later: conflict handling preserves both versions

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
2. Integration complexity if Gondolin is adopted (Tauri bridge + pi RPC semantics)
3. Scope-enforcement correctness across mount/user/sandbox layers
4. Network-control scope creep vs core v2 delivery
5. How far to push hardening before MVP learning loops

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
- ✅ Path I-lite I1 baseline landed:
  - Host validates working folders with canonicalization + workspace-root enforcement (`runtime_validate_working_folder`).
  - Host threads validated `workingFolderRelative` into `create_or_open_task` payload.
  - Guest validates relative subpaths and rejects traversal/symlink escapes (`WORKSPACE_POLICY_VIOLATION`).
  - Runtime state now exposes workspace root in harness dump-state output.
- ✅ Path I-lite I1b mount reliability baseline landed:
  - Runtime build now injects required 9p modules (`netfs`, `9pnet`, `9pnet_virtio`, `9p`) from `linux-virt` APK into initramfs.
  - Boot init explicitly loads modules before mount attempts.
  - Harness/QEMU logs now show mounted workspace and taskstate paths (`Mounted working folder at /mnt/workdir`, `Mounted task state at /mnt/taskstate`).
  - Active task cwd resolves to mounted workspace path (example: `/mnt/workdir/src`).
- ⚠️ Gate G1 decision documented as Path S, now reopened under Gate G2 reassessment.

Still open:

- ⏳ Phase 3I-lite I2: negative harness checks (escape attempts + cross-task bleed).
- ⏳ Focused resume-semantics checks (task-local memory seed test, no cross-task bleed assertions).
- ⏳ ADR defining MVP isolation guarantees and deferred hardening.
- ⏳ Gate G2 research lane (Gondolin feasibility + deeper hardening path comparison).

## Immediate next actions

1. Add negative harness tests for traversal/symlink/cross-task escape attempts
2. Capture MVP security contract in ADR and align UI copy with actual guarantees
3. Run focused resume-semantics checks with task-local memory seeds
