# Documentation Realignment Plan — Deep Cut (v2)

Status: archived\
Category: archive\
Date: 2026-02-07\
Owner: product/runtime\
Closed: 2026-02-07\
Archive note: deep-cut realignment passes completed; active docs index now lives in `../README.md`.

## Why v2 exists

Passes 1–4 fixed the obvious issues (archive closed plans, trim TODO, rename task command, de-dup runtime narrative).\
This v2 plan is for a deeper cleanup across **all docs** so we can:

- drop dead weight
- remove duplicate “source-of-truth” surfaces
- make current architecture and product direction obvious in <2 minutes
- keep pre-alpha velocity (no migration/compat shims)

## North star (target docs shape)

1. **Canonical docs are small and operational** (how Piwork works now).
2. **Research docs are explicitly non-normative** (spikes, ideas, exploration).
3. **Archive is historical only** (closed plans and superseded execution docs).
4. **TODO is the only execution backlog** (not roadmap + backlog + changelog mixed).

## Classification rubric

- **Canonical**: required for current implementation and day-to-day decisions.
- **Research**: useful context, not normative, may be stale by design.
- **Archive**: closed historical docs worth retaining.
- **Delete**: duplicates/noise already captured elsewhere.

## Current inventory and proposed disposition

| Doc                                              | Current state                       | Proposed action                                               |
| ------------------------------------------------ | ----------------------------------- | ------------------------------------------------------------- |
| `runtime-taskd-plan.md`                          | Canonical runtime narrative         | **Keep canonical** (primary runtime doc)                      |
| `runtime-taskd-rpc-spec.md`                      | Normative contract                  | **Keep canonical**                                            |
| `runtime-pack.md`                                | Runtime pack details                | **Keep canonical**                                            |
| `pi-integration.md`                              | Quick reference                     | **Keep canonical** (short, link-heavy)                        |
| `testing-strategy.md`                            | Test policy + layers                | **Keep canonical**                                            |
| `scope-negative-suite.md`                        | Standalone runbook (removed)        | **Merged into `testing-strategy.md`; standalone doc deleted** |
| `auth-flow.md`                                   | MVP auth behavior                   | **Keep canonical**                                            |
| `permissions-model.md`                           | MVP permission policy               | **Keep canonical**                                            |
| `task-artifact-contract.md`                      | Artifact/working-folder contract    | **Keep canonical**                                            |
| `research/followup-steering-spec.md`             | Deferred UX spec (research)         | **Keep in Research**                                          |
| `research/runtime-g2-architecture-spike.md`      | Post-MVP hardening spike (research) | **Keep in Research**                                          |
| `research/network-mitm-spike.md`                 | Future network spike (research)     | **Keep in Research**                                          |
| `research/*.md` (Cowork notes, sketches, maps)   | Exploratory references              | **Keep in Research**                                          |
| `product-direction.md`                           | Durable product principles          | **Keep canonical**                                            |
| `archive/ui-roadmap.md`                          | Historical directional roadmap      | **Keep archive**                                              |
| `archive/cleanup-execution-plan.md`              | Closed                              | **Keep archive**                                              |
| `archive/folder-artifact-implementation-plan.md` | Closed                              | **Keep archive**                                              |
| `archive/docs-realignment-plan.md` (this doc)    | Closed execution plan               | **Keep archive**                                              |

## Deep-cut execution passes

### Pass 0 — Full docs audit + labels

- Add/update front-matter on root docs:
  - `Status`
  - `Category` (`canonical` / `research` / `archive`)
  - `Owner`
  - `Last reviewed`
- Build a one-shot audit table in this plan (or `docs/archive/docs-audit-2026-02.md`) with final disposition.

### Pass 1 — Root hygiene (move non-canonical out)

- Move to `docs/research/`:
  - `runtime-g2-architecture-spike.md`
  - `network-mitm-spike.md`
  - `followup-steering-spec.md` (deferred design)
- Keep root focused on canonical docs + index.

### Pass 2 — Canonical compression

- Merge `scope-negative-suite.md` into `testing-strategy.md` and delete the standalone runbook.
- Audit canonical docs for overlap and trim repeated explanations.

### Pass 3 — Naming and path consistency (hard-cut, no aliases)

- Complete terminology/path cleanup from `path-i-lite` to `scope-negative` for operational surfaces:
  - harness script filename
  - docs filename/reference
  - task references already renamed (`mise run test-scope-negative`)
- Keep historical codename references only in ADR/history/research where context matters.

### Pass 4 — Product direction clarity

- Extract durable product principles from `ui-roadmap.md` into one concise canonical doc (recommended: `docs/product-direction.md`).
- Keep execution sequencing in `TODO.md` only.
- Move `ui-roadmap.md` to archive after extraction.

### Pass 5 — Final index + consistency sweep

- Rebuild `docs/README.md` with strict sections:
  - Canonical
  - Research
  - Archive
- Fix cross-links and stale paths.
- Run `mise run check-ci`.

## Execution progress (2026-02-07)

- [x] Pass 0 complete: root docs labeled with `Status` / `Category` / `Owner` / `Last reviewed`.
- [x] Pass 1 complete: non-canonical root docs moved to `docs/research/` and index/cross-links updated.
- [x] Pass 2 complete: scope-suite merged into `testing-strategy.md`; canonical overlap reduced.
- [x] Pass 3 complete: active operational surfaces use `scope-negative`; historical codename references are kept in ADR/research/archive only.
- [x] Pass 4 complete: product principles extracted to `product-direction.md`; `ui-roadmap.md` moved to archive.
- [x] Pass 5 complete: final docs index/cross-link sweep done and `mise run check-ci` passed.

## Decision points (defaults)

1. **Scope suite doc**: resolved — merged into `testing-strategy.md`; standalone doc deleted.
2. **`ui-roadmap.md`**: resolved — archived after extracting principles into `product-direction.md`.
3. **`research/followup-steering-spec.md`**: keep in research vs archive (default: research).
4. **Historical codename mentions**: keep only in research/archive/ADR docs (default: yes).

## Done criteria

- Root `docs/` contains canonical docs only.
- `docs/research/` contains all spikes/deferred designs.
- `docs/archive/` contains closed/superseded plans.
- No duplicate backlog surfaces (`TODO.md` is single execution source).
- Command/docs naming is plain-language on active operational surfaces.
- `mise run check-ci` passes.

## Closure

All planned passes are complete. This document is archived for historical context.
