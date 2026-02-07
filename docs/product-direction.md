# Product Direction

Status: active
Category: canonical
Owner: product
Last reviewed: 2026-02-07

## Mission

Build a Cowork-style desktop UI on top of pi that feels reliable for real file-scoped work:

- fast task switching without VM restarts
- clear task boundaries and scoped local access
- observable agent behavior (not black-box magic)

## Product principles

1. **Reliability before cleverness**
   - deterministic runtime/task behavior beats flashy but flaky flows.
2. **Task-scoped by default**
   - each task has explicit boundaries (folder, artifacts, session state).
3. **Visible actions and evidence**
   - users should see what happened and where outputs/logs live.
4. **One source of truth per concern**
   - runtime contract in runtime docs, execution backlog in `TODO.md`.
5. **Pre-alpha hard-cut simplicity**
   - no compatibility shims unless explicitly requested.

## Current strategy (what we optimize next)

### Foundation stability (Now)

- bootstrap/model sequencing reliability
- proper auth MVP (OAuth/API key, import as convenience)
- file import into `uploads` with immediate Scratchpad visibility

### Usability (Next)

- markdown rendering
- tool-call/action display in conversation
- richer, useful context panel

### Production readiness (Later)

- auth hardening diagnostics
- macOS-first distribution pilot once proper auth is stable
- runtime download/onboarding for non-dev users
- settings/docs/code cleanup once behavior stabilizes

## Source-of-truth boundaries

- **Direction and principles**: this doc.
- **Active execution plan**: `../TODO.md`.
- **Runtime architecture and contracts**: `runtime-taskd-plan.md`, `runtime-taskd-rpc-spec.md`, `pi-integration.md`.
- **Research/deferred design**: `docs/research/`.
