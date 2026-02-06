# Runtime Gate G2 — Architecture Reassessment (Isolation vs Gondolin)

Status: active (post-MVP research lane; non-blocking)
Owner: runtime/platform
Related: `docs/runtime-v2-taskd-plan.md`, `docs/permissions-model.md`, `docs/research/cowork-claude-runtime-intel-2026-02-06.md`, `docs/adr/0001-runtime-g2-decision.md`

> MVP interim decision is already recorded in ADR 0001: **Path I-lite is selected for MVP shipment**.
> This document remains the research checklist for post-MVP hardening/path validation.

## Why this exists

We completed runtime v2 Phase 0–2 (taskd lifecycle/switch/prompt) and removed the restart-heavy path for normal v2 switching.

Next work (workspace + sandbox strategy) needs a reset:

- Sync-first (Path S) increased complexity quickly.
- Security goals now emphasize enforceable task scope, not just data shuttling.
- We want a smaller, clearer MVP security story.

## Candidate paths

### Path I — Isolation-first on current runtime

Build on existing Tauri + QEMU + taskd stack.

Core ideas:

- mount only scoped workspace root (no broad home mount)
- strict task-folder scope checks
- per-task Linux users
- staged sandbox boundary (filesystem allowlist + privilege drop)

### Path G — Gondolin-based runtime

Evaluate using Gondolin as the VM/sandbox substrate.

Core ideas:

- programmable VFS/network primitives out of the box
- integrate pi RPC + current task model on top
- verify Tauri integration cost and operational fit

### Path S — Sync-first fallback

Keep as fallback only.

- retain `runtime_v2_sync` docs/protocol draft
- do not continue major implementation unless selected after G2

## Shared acceptance criteria

Any selected path must satisfy all:

1. No VM restart on task switch/folder switch in normal path
2. Enforceable task file scope (not cwd convention only)
3. No cross-task data bleed
4. Prompt + switch latency acceptable for Cowork-style UX
5. Integration cost is realistic for current team/stage

## Spike tasks

### G2-a: Gondolin feasibility spike

- Run pi in Gondolin guest with RPC bridge
- Verify task switching semantics with existing UI model
- Validate scoped write behavior with negative tests (traversal/symlink/cross-task)
- Measure warm/cold switching behavior and prompt path overhead

### G2-b: Isolation-first spike (current runtime)

- Implement scoped mount root + strict task-folder checks
- Prototype per-task user launch path
- Validate write-scope enforcement with negative tests
- Measure latency impact and switching stability

## Evidence required

For each claim:

1. `mise run test-dump-state`
2. `mise run test-screenshot <name>`
3. relevant logs (`tmp/dev/piwork.log`, `qemu.log`)
4. short note with observed trade-offs

## Decision output

Maintain ADR `docs/adr/0001-runtime-g2-decision.md` with:

- current selected path status
- rejected/deferred alternatives (and why)
- explicit MVP guarantees vs deferred hardening
- post-MVP execution plan updates as research evidence arrives
