# ADR 0001: Runtime Gate G2 Decision (Isolation-first vs Gondolin vs Sync fallback)

- Status: Proposed
- Date: 2026-02-06
- Owners: runtime/platform
- Related:
  - `docs/runtime-v2-taskd-plan.md`
  - `docs/runtime-g2-architecture-spike.md`
  - `docs/runtime-v2-taskd-sync-spec.md`
  - `docs/permissions-model.md`

## Context

Runtime v2 Phase 0–2 is complete:

- `taskd` process-per-task model is in place
- host switch/prompt routing is v2-native (ACK + `task_ready`)
- normal v2 flow no longer depends on VM restart/hydration fallback

The remaining architecture decision is workspace/sandbox strategy.

Historically, Path S (sync-first) was selected at Gate G1, but that decision is now reopened. We need a clear Gate G2 decision that balances:

- enforceable task isolation
- UX latency and reliability
- implementation complexity for current team/stage

## Decision drivers

1. No VM restart on task/folder switching in normal path
2. Enforceable task file scope (not cwd convention only)
3. No cross-task data bleed
4. Cowork-style responsiveness for prompt + switching
5. Feasible implementation/maintenance cost

## Options considered

### Path I: Isolation-first on current runtime

Short description:

- keep current Tauri + QEMU + taskd architecture
- implement scoped workspace-root mount + strict folder checks
- add per-task Linux users and staged sandbox hardening

Pros:

- reuses current working codebase
- smallest migration surface
- keeps existing harness and runtime control plane

Cons:

- requires careful hardening work in current stack
- network policy still future work unless explicitly added

### Path G: Gondolin-based runtime

Short description:

- adopt Gondolin for VM substrate + programmable VFS/network
- bridge existing pi RPC/task model to Gondolin control plane

Pros:

- strong sandbox primitives out of the box
- programmable filesystem/network model aligns with long-term goals

Cons:

- migration/integration complexity (Tauri ↔ Node runtime bridge)
- unknowns around pi RPC/session semantics under new substrate

### Path S: Sync-first fallback

Short description:

- continue host↔guest manifest/read/apply sync model

Pros:

- can avoid broad mount patterns
- keeps host policy central

Cons:

- high complexity/surface area
- stale-read and pre/post-sync latency risks
- weaker fit for “filesystem as primary interface” workflows

## Spike evidence summary

> Fill this after G2-a and G2-b spikes.

| Criterion             | Path I result | Path G result | Notes |
| --------------------- | ------------- | ------------- | ----- |
| No restart switching  | TBD           | TBD           |       |
| Scope enforcement     | TBD           | TBD           |       |
| Cross-task isolation  | TBD           | TBD           |       |
| Prompt/switch latency | TBD           | TBD           |       |
| Integration effort    | TBD           | TBD           |       |

Evidence links:

- State snapshots: TBD
- Screenshots: TBD
- Logs: TBD

## Decision

- Selected path: **TBD**
- Decision date: **TBD**
- Decision rationale:
  - TBD

## MVP guarantees we can claim

> Keep this short and externally honest.

1. TBD
2. TBD
3. TBD

## Deferred hardening (explicit)

- TBD

## Implementation plan (post-decision)

### Phase 3 (selected path)

- [ ] Task 1
- [ ] Task 2
- [ ] Task 3

### Validation

- [ ] `mise run test-dump-state`
- [ ] `mise run test-screenshot <name>`
- [ ] supporting log lines (`tmp/dev/piwork.log`, `qemu.log`)
- [ ] regression checks (`mise run check`)

## Consequences

### Positive

- TBD

### Negative / trade-offs

- TBD

## Rollback / fallback plan

If selected path fails acceptance criteria during implementation:

1. pause rollout behind feature flags
2. preserve Phase 0–2 baseline behavior
3. return to Gate G2 alternatives with recorded failure evidence

## Open questions

- TBD
