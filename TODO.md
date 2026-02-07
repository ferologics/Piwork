# TODO

> Execution sequencing for cleanup work lives in `docs/cleanup-execution-plan.md` (execution archive + remaining closeout checklist).

## Now: Foundation cleanup

- [ ] **Testing sanity gate (P0)** — define and ship a real automated regression suite for the liftoff path (Vitest + Rust), keep daily checks fast (`mise run check`) while enforcing live regressions in `mise run check-full`, and stop relying on ad-hoc/manual shell-harness runs for core correctness.
  - [x] Add a machine-readable `state_snapshot` contract for deterministic assertions (no log-grep testing).
  - [x] Add first gated Vitest regression: reopen cwd correctness (`/mnt/workdir...`) on folder-bound task reopen.
  - [x] Add remaining gated Vitest regressions: folder-bind continuity (no UI reset), working-folder panel refresh on folder change, and runtime-mismatch badge rules.
  - [x] Add one sequential live journey canary (messages + models + workdir + artifacts + reopen), while keeping focused canaries for isolated invariants.
  - [x] Add CI enforcement for both gates (`check` on PRs, `check-full` required before merge).
  - [x] Remove low-signal/noise tests and stale assertions (smoke test, legacy session-file assumptions, noisy debug logs).
  - [x] Add `mise run test-regressions` task (currently runs live-app regression tests).
  - [x] Split gates: `mise run check` (fast) and `mise run check-full` (includes regressions).
  - [x] Add path-aware regression gating for push/CI so live tests only run when integration-impacting files change.
  - [ ] Burn in the CI/hook split gate behavior (`check-full` skip/run on path filters + `PIWORK_FORCE_CHECK_FULL=1` local pre-push path), then mark this parent item done.
  - [x] Add fast protocol guardrail (`mise run audit-protocol`) via Vitest contract tests.
- [x] **Kill v1 runtime** — remove `PIWORK_RUNTIME_V2_TASKD` flag, v1 code paths in runtimeService (`handleTaskSwitchV1`, `handleFolderChangeV1`, `ensureTaskSessionReady`), v1 `nc -l` loop in init script, `RuntimeMode` type. taskd is the only runtime.
- [x] **Enforce V2-only host protocol** — removed legacy host request handling in taskd, host parser is strict `{ id, type, payload }`, and RuntimeService only resolves pending RPCs from taskd V2 response envelopes.
- [x] **Finalize runtime naming cleanup (P0)** — dropped `handleV2*`/`sendV2*` helper names, removed the `__legacy__` sentinel path from runtime/UI mismatch logic, and switched to neutral runtime envelope naming.
- [x] **Extract init script** — move the heredoc out of `mise-tasks/runtime-build` into `runtime/init.sh`
- [x] **Fix context pollution** — infrastructure bash commands (grep mount check, mkdir, session writes) go through pi's RPC and pollute the agent's conversation. Add `system_bash` to taskd that bypasses pi sessions, or do checks in taskd before spawning pi.
- [x] **Simplify auth/settings** — strip Settings modal to: show current auth status + "Import from pi" button. Kill multi-profile UI. For MVP: baked auth or `~/.pi/agent/auth.json` import.
- [ ] **Proper auth MVP (P0)** — make auth first-class for non-existing pi setups: working OAuth `/login` flow and provider API key entry in Settings; keep "Import from pi" as convenience, not primary path.
- [x] **Lock working folder after first bind** — `workingFolder` supports one-time bind (`null -> path`), then becomes immutable for that task; use a new task for a different folder.
- [x] **Define task artifact persistence contract** — documented in `docs/task-artifact-contract.md` (`outputs` writable, `uploads` read-only, Scratchpad aggregates both).
- [x] **Implement artifact contract in runtime/UI** — enforce one-time folder bind, surface Scratchpad from `outputs` + `uploads`, and apply uploads read-only policy.
- [ ] **Add file import UX (P0)** — support importing local files into task `uploads`, then show/preview them in Scratchpad immediately while keeping uploads read-only after import.
- [ ] **Untangle auth state from runtime artifacts** — keep auth storage purpose clear; avoid mixing credentials with unrelated pi/session artifacts.
- [ ] **Fix sendLogin optimistic log** — logs `[info] Sent /login` even if not connected
- [x] **Fix opener permission path** — added `opener:allow-open-path` capability so `Open in Finder` is authorized.
- [x] **Fix right-panel error isolation** — Working-folder action errors are now scoped to the Working folder card.
- [x] **Fix first `/mnt/workdir` write reliability (race mitigation)** — task-bound folder changes now mark `taskSwitching` before validation, and prompt send is blocked until runtime is ready.
- [x] **Add harness regression for working-folder writes** — set folder → write file immediately → assert host path has file.
- [x] **Add harness check for open-folder action** — validate Working-folder header icon opens Finder path successfully.
- [ ] **Inject minimal FS runtime hint into prompts** — include working-folder host path + `/mnt/workdir` alias + scratchpad path, and refresh when folder is bound later (not just at startup).
- [x] **Fix dev cwd chip staleness on task reopen** — reopen now validates persisted working folder before runtime prep, then refreshes on `task_ready`, so cwd settles to `/mnt/workdir...` instead of sticking at `/mnt/taskstate/.../outputs`.
- [ ] **Delete remaining slop (P0)** — review docs and code for stale references to v1/v2/legacy naming, old sync protocol language, and obsolete smoke-suite assumptions.
- [ ] **Script hygiene pass (P0)** — reduce `scripts/` sprawl by making `mise` the single entrypoint for dev/test ops, moving one-off experiments to `scripts/lab/`, and deleting wrappers not used by `mise` or CI.
- [ ] **Dev watch scope (P0)** — avoid restarting `tauri dev` for non-runtime docs/content edits (e.g. Markdown), keep hot reload scoped to relevant source/config files.
- [ ] **Close out cleanup execution plan (P0)** — finish remaining PR-5 leftovers (naming consistency, slop purge, script/watch hygiene), then mark `docs/cleanup-execution-plan.md` closed.
- [x] **Roadmap sync hygiene** — synced `docs/ui-roadmap.md` with current `TODO.md` execution state (2026-02-07).

## Next: Make it usable

- [x] **Model picker realism (no fake fallback)** — removed hardcoded fallback model lists in runtime/UI; model picker now uses runtime-reported models only.
- [x] **Model availability empty/error state** — picker now shows explicit loading/empty/error states and disables selection when unavailable.
- [ ] **Model scope toggle in Settings** — add `Preferred only` (default shortlist we define) vs `All available` filtering for model picker results.
- [x] **Persist model selection to task metadata** — picker updates now persist `{ provider, model }` on task metadata so switching/reopening tasks restores model intent.
- [x] **Finish auth profile cull for MVP** — removed profile switching plumbing; runtime/test/auth paths are standardized on the default profile.
- [ ] **Markdown rendering** — render agent responses (bold, lists, code blocks). Biggest UX gap.
- [ ] **Tool call display** — collapsible "Created a file ›", "Ran command ›" in message stream
- [ ] **Interruptible composer (steering + follow-ups)** — deferred spec captured in `docs/followup-steering-spec.md` (`Enter` while running = steering, `Option+Enter` = queue follow-up, `Option+Up` = recall queued draft, `Esc`/Stop button = interrupt). Revisit after Markdown + tool-call display stabilize.
- [x] **Right panel IA pass** — replace “Downloads” with “Working folder” card semantics (dynamic title = folder basename when set), clear empty states, and open-in-Finder affordance.
- [x] **Move Working-folder open action to header** — icon-only action is now in card header (left of chevron), body button removed.
- [x] **Scratchpad continuity** — keep Scratchpad visible for every task and aggregate artifacts from both `outputs` and `uploads`.
- [x] **Artifact explorer parity** — make file listing/preview behavior consistent across working-folder and no-folder tasks, including uploads read-only behavior.
- [x] **Auto-refresh artifact panels** — Scratchpad now refreshes on `tool_execution_end` / `turn_end` / `agent_end` events (manual refresh still available).
- [x] **Working-folder file visibility** — Working-folder card now lists files and updates from runtime events.
- [ ] **Context panel usefulness (enrichment)** — panel exists; improve it to surface active connectors/tools and task-referenced files instead of mostly static copy.

## Later: Production

- [ ] **Auth hardening follow-up** — provider-by-provider `/login` reliability through VM NAT, edge-case diagnostics, and clearer failure UX after proper auth MVP ships.
- [ ] **Multi-task runtime behavior** — define expected behavior for switching between active tasks without losing running session state (foreground/background semantics, status visibility, resume behavior).
- [ ] **Runtime download** — first-run pack download for non-dev users
- [ ] **Bundle pi** — include pi in runtime pack instead of copying from global npm
- [ ] **Onboarding** — first-run experience that doesn't require `mise run runtime-build`
- [ ] **Settings cleanup** — audit settings surface and remove dead/low-value controls

## Later: Polish

- [ ] **Doc cleanup** — consolidate stale docs, kill anything that doesn't match reality
- [ ] **Code cleanup** — deep pass, remove slop, consistent patterns
- [ ] **Task title editing** — editable at top of conversation
- [ ] **Progress indicators** — checkmarks/status hints in right panel for task progress
- [ ] **Profile chip** — bottom-left identity/plan/status chip
- [ ] **Empty state polish** — shuffleable task categories + "See more ideas" + richer task tiles like Cowork
- [ ] **Progress model v2 (non-P0)** — experiment with Cowork-style step/milestone summaries inferred from task/tool activity, with clear confidence/limitations.

## Someday

- [ ] Connectors (Calendar, Slack, Google Drive, Notion)
- [ ] Clipboard + attachments (images/files with MIME-aware previews)
- [ ] Multi-folder tasks
- [ ] Cross-platform (Linux/Windows)
- [ ] MITM network proxy
- [ ] Canvas/rich artifact viewer
- [ ] qcow2 rootfs (lower RAM)
- [ ] Gate G2 — Gondolin vs deeper sandbox hardening (research only)

## Testing

- Harness primitives: `test-start`, `test-prompt`, `test-screenshot`, `test-set-folder`, `test-set-task`, `test-create-task`, `test-delete-tasks`, `test-dump-state`, `test-state-snapshot`, `test-runtime-diag`, `test-stop`, `test-open-preview`, `test-write-working-file`, `test-open-working-folder`, `test-auth-*`, `test-send-login`, `test-check-permissions`
- Scope enforcement: `scripts/harness/path-i-lite-negative.sh`
- Rule: primitives only, no monolithic E2E scripts
