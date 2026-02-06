# Runtime Plan — Task Supervisor (`taskd`) + Staged Workspace Strategy

> **Status update (2026-02-06):** taskd is the active runtime baseline and the legacy v1 mode has been removed. MVP execution is on **Path I-lite** (strict scope enforcement on current runtime, no sync expansion). Path G (Gondolin) remains a research lane via Gate G2.

## Why this plan exists

The old runtime mixed too many orchestration models (session switching, restart fallbacks, hydration fallbacks), which made task switching fragile and hard to reason about.

This plan keeps one clear baseline:

- one shared VM
- one long-lived `taskd` supervisor
- one pi process per task
- deterministic task lifecycle and switch semantics

## Goals

1. **No VM restart on normal task switch**
2. **No transcript hydration fallback in normal path**
3. **Deterministic per-task resume** from canonical session files
4. **Predictable switch latency** (few seconds max)
5. **Lower UI orchestration complexity** (`MainView` stays UI-focused)

## Non-goals (current stage)

- full hostile-code sandbox hardening before MVP
- final network mediation/mitm policy before MVP
- cross-platform parity in first pass

## Locked decisions (current)

- **Taskd is the only runtime mode.** No runtime mode flags, no v1 fallback path.
- `stop_task` is a required baseline RPC.
- Runtime orchestration belongs in `runtimeService`, not `MainView`.
- MVP ships on **Path I-lite** (scoped local mode with host+guest policy checks).
- Sync-heavy protocol work stays deferred unless Path S is explicitly re-selected.
- Post-MVP hardening direction is tracked under **Gate G2**.

## Target architecture

### Host (Tauri)

- owns VM lifecycle and transport
- runtime service owns task switch + timeout handling
- persists task metadata + conversation cache
- sends task intents to guest taskd

### Guest (VM)

- `init` is PID 1
- `init` mounts required shares
- `init` starts long-lived `taskd`
- `taskd` supervises one pi process per task

Per task in guest:

- `/sessions/<taskId>/session.json` (canonical semantic state)
- `/mnt/taskstate/<taskId>/outputs/` (task-local writable artifacts)
- `/mnt/taskstate/<taskId>/uploads/` (task-local read-only artifacts)

Per task on host:

- `task.json`
- `conversation.json` (UI cache)

## Runtime contract (baseline)

### Task lifecycle state machine

`missing -> creating -> ready -> active -> idle -> errored -> stopped`

### Baseline RPC surface

- `create_or_open_task(taskId, model, thinkingLevel, workingFolder?)`
- `switch_task(taskId)`
- `prompt(message)`
- `runtime_get_state()`
- `pi_get_available_models()`
- `pi_set_model(provider, modelId)`
- `extension_ui_response(payload)`
- `system_bash(command, cwd?)` (infra lane, no session pollution)
- `stop_task(taskId)`

Companion wire contract (P0 normative): `docs/runtime-taskd-rpc-spec.md`

### Event stream (minimum)

- `task_switch_started(taskId)`
- `task_ready(taskId)`
- `task_error(taskId, code, message)`
- `task_stopped(taskId)`
- `agent_output(taskId, chunk)`
- `agent_end(taskId, usage?)`

### Switch semantics

- `switch_task` returns quick ACK (`status: "switching"`)
- host waits for `task_ready`
- host applies hard timeout and exits spinner deterministically

Latency targets (initial budgets):

- warm switch p95 `< 1s`
- cold resume p95 `< 3s`

### Session durability and crashes

- `session.json` is canonical semantic truth
- persist atomically on completed turn (`agent_end`)
- if pi crashes mid-turn before flush, last in-flight turn may be lost
- taskd detects child exit, marks task `errored`, emits `task_error` (`PI_PROCESS_DEAD`)

## Workspace + sandbox strategy (Gate G2)

Detailed spike checklist: `docs/runtime-g2-architecture-spike.md`.

Current position:

- **Path I-lite** is selected for MVP shipment.
- **Path G (Gondolin)** remains research.
- **Path S (sync-first)** remains fallback only.

Decision criteria:

- no VM restart for normal switch flow
- enforceable task file scope (not cwd convention only)
- no cross-task data bleed
- acceptable prompt/switch UX latency
- feasible implementation cost for current stage

Required evidence for any runtime claim:

1. `test-dump-state`
2. `test-screenshot <name>`
3. supporting runtime logs
4. short ADR/note for material decisions

## Security invariants

### Mandatory now (MVP)

- host-authoritative workspace root checks
- reject traversal / invalid path bytes
- reject symlink escapes for scoped operations
- reject special files for preview/scope-sensitive paths

### Deferred hardening (post-MVP)

- per-task Linux users + stricter ownership boundaries
- stronger sandbox boundary for untrusted code
- finer network mediation controls

## Network policy roadmap

- current baseline: NAT + existing connector/tool gating
- strict host-mediated network policy is post-MVP work

## Execution plan

### Phase 0 — taskd baseline (complete)

- runtime orchestration extracted to `runtimeService`
- guest taskd lifecycle/switch/prompt/runtime_get_state/stop_task implemented
- host switch handshake + timeout behavior in place
- normal path no longer depends on VM restart/hydration fallback

### Phase 1 — Path I-lite scope enforcement (active baseline)

- host working-folder validation + workspace-root enforcement
- guest relative-path validation + traversal/symlink rejection
- mount reliability fixes in runtime pack
- repeatable negative suite for scope escapes

### Gate G2 — post-MVP architecture research (active, non-blocking)

- Path I hardening spikes
- Path G Gondolin feasibility spikes
- explicit ADR update when direction changes

### Phase 2 — hardening tranche (post-MVP)

- reaping policies + resource bounds
- deeper isolation boundary (based on Gate G2 decision)
- observability upgrades for taskd + host runtime service

### Phase 3 — cleanup pass

- remove stale docs and terminology
- align runtime/auth/settings semantics
- keep one coherent runtime model across docs and code

## Testing plan

Use harness primitives only.

Core checks:

- no cross-task memory bleed
- no long-running spinner on switch
- `task_switch_started -> task_ready` within timeout budget
- resume correctness after app restart

Scope checks:

- path traversal blocked with deterministic policy error
- symlink escape blocked
- cross-task file visibility/write denied

## Risks / open questions

1. taskd child lifecycle behavior under sustained load
2. integration complexity if Path G is selected later
3. scope-enforcement correctness across host+guest boundaries
4. where to draw MVP vs post-MVP hardening line

## Progress snapshot (2026-02-06)

Completed in code:

- ✅ taskd-only runtime baseline is in place (legacy mode removed)
- ✅ runtime orchestration moved from `MainView.svelte` to `runtimeService`
- ✅ init script extracted to `runtime/init.sh`
- ✅ context-pollution fix: infra shell commands now have explicit `system_bash` lane in taskd
- ✅ Path I-lite scope checks and mount reliability fixes landed
- ✅ resume-semantics and scope-negative harness evidence captured
- ✅ auth mount path is default-only (`/mnt/authstate/default`) with baked-auth fallback

Still open:

- ⏳ auth storage/runtime artifact separation cleanup
- ⏳ sendLogin optimistic log cleanup
- ⏳ docs slop cleanup beyond core runtime docs
- ⏳ Gate G2 research lane (non-blocking)

## Immediate next actions

See `TODO.md` — finish foundation cleanup items, then move to usability work (Markdown rendering first).
