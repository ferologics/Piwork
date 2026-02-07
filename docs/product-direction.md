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

## Differentiation thesis (after cowork parity)

Once baseline cowork flows are solid, piwork differentiates on three combined qualities:

1. **Provider freedom without workflow loss**
   - users can switch providers/models while keeping the same task structure, tools, and outputs.
2. **Execution environment, not chat shell**
   - actions run in a scoped runtime with visible artifacts and replayable evidence.
3. **General-purpose workflows (not just coding)**
   - optimize for day-to-day knowledge work outcomes, not only developer tasks.

## Capability expansion bets

### Connectors first (MCP + native where needed)

- prioritize high-frequency surfaces: Google Drive/Docs/Sheets, Slack, Notion, GitHub.
- start read-first (import/search/summarize), then add guarded write actions.
- expose connector permissions per task so boundaries stay explicit.

### Skills as reusable jobs

- ship curated "day-to-day" skills (research brief, meeting follow-up, spreadsheet cleanup, document transform, review/summarize).
- keep skill outputs file-based and auditable in task artifacts.
- make "run this skill on this folder/doc set" a first-class flow.

### Easy skill creation

- provide a minimal skill scaffold wizard (goal, inputs, tools, output contract).
- support local testing + one-click install into piwork.
- enable team sharing/import of skill packs after local workflow stabilizes.

## Sequencing guidance

1. **Ship** macOS-first cowork basics + reliability (cross-platform follows after baseline proves out).
2. **Layer in** top connectors with strict task-scoped permissions.
3. **Package** high-value default skills for non-coder daily workflows.
4. **Open up** skill creation/distribution once core UX is proven stable.

## Source-of-truth boundaries

- **Direction and principles**: this doc.
- **Active execution plan**: `../TODO.md`.
- **Runtime architecture and contracts**: `runtime-taskd-plan.md`, `runtime-taskd-rpc-spec.md`, `pi-integration.md`.
- **Research/deferred design**: `docs/research/`.
