# MVP Definition (v0)

Status: active baseline
Date: 2026-02-06

This document locks the practical MVP scope so engineering and UX decisions stay aligned.

## 1) Must-have MVP scope

MVP is considered usable when all of the following work reliably:

1. **Task lifecycle (local)**
   - create task
   - switch task without VM restart in normal v2 flow
   - resume task-local context
2. **Prompt loop**
   - send prompt
   - receive streamed response
   - preserve per-task conversation/session continuity
3. **Working folder flow**
   - select a working folder
   - enforce scoped local access (Path I-lite)
4. **File preview flow**
   - list task folder files
   - open preview in main split pane (not in right panel)
   - support text + image preview

## 2) Auth/login decision for MVP

MVP does **not** require a fully polished in-app OAuth/login product flow.

MVP auth baseline:

- Primary path: bootstrap auth via runtime rebuild with baked credentials (`mise run runtime-build-auth`, optional `PIWORK_AUTH_PATH`).
- Secondary path: experimental Settings auth UI (API key/profile storage) is available for dev use.
- In-chat auth hints are acceptable as fallback guidance.

Out of MVP:

- robust end-user OAuth onboarding UX
- full provider lifecycle and refresh UX

## 3) Settings scope for MVP

Keep settings **minimal** for MVP:

- keep auth/profile controls
- avoid expanding general preferences/settings surface
- defer non-critical settings until post-MVP validation

## 4) First-run flow for MVP

First run is intentionally simple and explicit:

1. If runtime pack is missing, show setup-required screen with runtime path and command guidance.
2. User runs runtime build (`mise run runtime-build` / `runtime-build-auth`) and retries.
3. If auth is missing, user follows auth hint/banner guidance.
4. User can create first task and prompt immediately once runtime is ready.

## 5) Honest MVP guarantees

- Scoped local mode is enforced for task folder access.
- Task switching/prompting is v2-taskd-first with no normal-path VM restart.
- This is not yet a hardened hostile-code sandbox.

## 6) Deferred from MVP

- polished OAuth product flow
- runtime download/update installer UX for non-dev users
- deep sandbox hardening and post-MVP G2 path work
- connectors and advanced artifact/canvas surfaces
