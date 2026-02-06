# ADR 0001: Runtime Gate G2 Decision (Isolation-first vs Gondolin vs Sync fallback)

- Status: Accepted (MVP interim)
- Date: 2026-02-06
- Owners: runtime/platform
- Related:
  - `docs/runtime-taskd-plan.md`
  - `docs/runtime-g2-architecture-spike.md`
  - `docs/permissions-model.md`
  - `docs/path-i-lite-negative-suite.md`

## Context

Runtime Phase 0–2 is complete:

- `taskd` process-per-task model is in place
- host switch/prompt routing is runtime-native (ACK + `task_ready`)
- normal runtime flow no longer depends on VM restart/hydration fallback

The remaining architecture decision is workspace/sandbox strategy.

Historically, Path S (sync-first) was selected at Gate G1, but that decision was reopened.
For MVP we need enforceable scoped access now, without blocking on deep runtime migration.

## Decision drivers

1. No VM restart on task/folder switching in normal path
2. Enforceable task file scope (not cwd convention only)
3. No cross-task data bleed in normal task flows
4. Cowork-style responsiveness for prompt + switching
5. Feasible implementation/maintenance cost for current stage

## Options considered

### Path I: Isolation-first on current runtime

Short description:

- keep current Tauri + QEMU + taskd architecture
- enforce scoped workspace-root access + strict folder checks
- defer per-task users/stronger sandboxing to post-MVP

### Path G: Gondolin-based runtime

Short description:

- adopt Gondolin for VM substrate + programmable VFS/network
- bridge existing pi RPC/task model to Gondolin control plane

### Path S: Sync-first fallback

Short description:

- continue host↔guest manifest/read/apply sync model

## Spike evidence summary (MVP track)

| Criterion             | Path I-lite result | Path G result   | Notes                                       |
| --------------------- | ------------------ | --------------- | ------------------------------------------- |
| No restart switching  | Pass               | Not run for MVP | taskd baseline retained                     |
| Scope enforcement     | Pass (MVP scope)   | Not run for MVP | host+guest checks + workspace-root plumbing |
| Cross-task isolation  | Pass (MVP scope)   | Not run for MVP | resume baseline + negative scope harness    |
| Prompt/switch latency | Pass               | Not run for MVP | within current taskd expectations           |
| Integration effort    | Lowest             | High/unknown    | Path I-lite chosen for delivery speed       |

Evidence links:

- State snapshots/screenshots/logs from runtime and Path I-lite runs in `tmp/dev/`
- Repeatable negative suite: `docs/path-i-lite-negative-suite.md`

## Decision

- Selected path: **Path I-lite for MVP**
- Decision date: **2026-02-06**
- Decision rationale:
  - Delivers enforceable scoped access in the current architecture.
  - Preserves taskd UX (no switch-triggered VM restart).
  - Avoids a high-risk migration before MVP learning loops.
  - Keeps Gate G2 research alive without blocking shipment.

## MVP guarantees we can claim

1. **Scoped local mode:** task file access is limited to the task’s selected folder under the configured workspace root.
2. **Policy guards:** traversal/symlink escape attempts are rejected by host/guest policy checks.
3. **Task separation:** task sessions are isolated per task; normal switching/resume should not cross-pollinate context.

## Deferred hardening (explicit)

- Per-task Linux users and stricter ownership boundaries
- Stronger sandbox boundary for hostile/untrusted code execution
- Fine-grained network policy/mediation
- Gondolin feasibility decision for post-MVP runtime evolution

## Implementation plan (post-decision)

### MVP path (Path I-lite)

- [x] Host+guest scope checks and workspace-root-relative plumbing
- [x] Mount reliability for workspace/taskstate in runtime path
- [x] Repeatable negative checks for traversal/symlink/cross-task scope
- [x] Honest UI copy for scoped local mode guarantees

### Validation

- [x] `mise run test-dump-state`
- [x] `mise run test-screenshot <name>`
- [x] supporting log lines (`tmp/dev/piwork.log`, `qemu.log`)
- [x] regression checks (`mise run check`)

## Consequences

### Positive

- Ships practical scoped access controls in MVP timeline
- Keeps runtime model simple and consistent (taskd-first)
- Leaves room for post-MVP hardening without churn now

### Negative / trade-offs

- Not a hardened hostile-code sandbox yet
- Network policy remains coarse in MVP
- Some deep isolation guarantees are explicitly deferred

## Rollback / fallback plan

If Path I-lite regresses critical behavior:

1. pin to the last known-good runtime baseline commit
2. preserve Phase 0–2 baseline behavior
3. revisit Gate G2 alternatives with recorded failure evidence

## Open questions

- Whether post-MVP hardening should stay on current runtime or move to Gondolin
- How far to push per-task sandboxing before introducing network mediation
