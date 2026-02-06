# TODO

> Execution sequencing for cleanup work lives in `docs/cleanup-execution-plan.md` (final plan).

## Now: Foundation cleanup

- [x] **Kill v1 runtime** — remove `PIWORK_RUNTIME_V2_TASKD` flag, v1 code paths in runtimeService (`handleTaskSwitchV1`, `handleFolderChangeV1`, `ensureTaskSessionReady`), v1 `nc -l` loop in init script, `RuntimeMode` type. taskd is the only runtime.
- [x] **Rename v2_taskd → runtime** — drop "v2" prefix everywhere (types, logs, flags, docs)
- [x] **Extract init script** — move the heredoc out of `mise-tasks/runtime-build` into `runtime/init.sh`
- [x] **Fix context pollution** — infrastructure bash commands (grep mount check, mkdir, session writes) go through pi's RPC and pollute the agent's conversation. Add `system_bash` to taskd that bypasses pi sessions, or do checks in taskd before spawning pi.
- [x] **Simplify auth/settings** — strip Settings modal to: show current auth status + "Import from pi" button. Kill multi-profile UI. For MVP: baked auth or `~/.pi/agent/auth.json` import.
- [x] **Lock working folder after first bind** — `workingFolder` supports one-time bind (`null -> path`), then becomes immutable for that task; use a new task for a different folder.
- [x] **Define task artifact persistence contract** — documented in `docs/task-artifact-contract.md` (`outputs` writable, `uploads` read-only, Scratchpad aggregates both).
- [x] **Implement artifact contract in runtime/UI** — enforce one-time folder bind, surface Scratchpad from `outputs` + `uploads`, and apply uploads read-only policy.
- [ ] **Untangle auth state from runtime artifacts** — keep auth storage purpose clear; avoid mixing credentials with unrelated pi/session artifacts.
- [ ] **Fix sendLogin optimistic log** — logs `[info] Sent /login` even if not connected
- [x] **Fix opener permission path** — added `opener:allow-open-path` capability so `Open in Finder` is authorized.
- [x] **Fix right-panel error isolation** — Working-folder action errors are now scoped to the Working folder card.
- [x] **Fix first `/mnt/workdir` write reliability (race mitigation)** — task-bound folder changes now mark `taskSwitching` before validation, and prompt send is blocked until runtime is ready.
- [ ] **Add harness regression for working-folder writes** — set folder → write file immediately → assert host path has file.
- [ ] **Add harness check for open-folder action** — validate Working-folder header icon opens Finder path successfully.
- [ ] **Inject minimal FS runtime hint into prompts** — include working-folder host path + `/mnt/workdir` alias + scratchpad path, and refresh when folder is bound later (not just at startup).
- [ ] **Fix dev cwd chip staleness on task reopen** — top-bar runtime cwd can remain at `/mnt/taskstate/.../outputs` even after task runtime moves to `/mnt/workdir`.
- [ ] **Delete remaining slop** — review docs for stale references to v1, v2 flags, sync protocol, smoke suites
- [ ] **Dev watch scope** — avoid restarting `tauri dev` for non-runtime docs/content edits (e.g. Markdown), keep hot reload scoped to relevant source/config files.
- [x] **Roadmap sync hygiene** — synced `docs/ui-roadmap.md` with current `TODO.md` execution state (2026-02-06).

## Next: Make it usable

- [x] **Model picker realism (no fake fallback)** — removed hardcoded fallback model lists in runtime/UI; model picker now uses runtime-reported models only.
- [x] **Model availability empty/error state** — picker now shows explicit loading/empty/error states and disables selection when unavailable.
- [ ] **Model scope toggle in Settings** — add `Preferred only` (default shortlist we define) vs `All available` filtering for model picker results.
- [ ] **Persist model selection to task metadata** — write picker changes back to `taskStore.model` so switching/reopening tasks restores model intent.
- [ ] **Finish auth profile cull for MVP** — remove remaining multi-profile runtime/test plumbing and standardize on the default profile path.
- [ ] **Markdown rendering** — render agent responses (bold, lists, code blocks). Biggest UX gap.
- [ ] **Tool call display** — collapsible "Created a file ›", "Ran command ›" in message stream
- [x] **Right panel IA pass** — replace “Downloads” with “Working folder” card semantics (dynamic title = folder basename when set), clear empty states, and open-in-Finder affordance.
- [x] **Move Working-folder open action to header** — icon-only action is now in card header (left of chevron), body button removed.
- [x] **Scratchpad continuity** — keep Scratchpad visible for every task and aggregate artifacts from both `outputs` and `uploads`.
- [x] **Artifact explorer parity** — make file listing/preview behavior consistent across working-folder and no-folder tasks, including uploads read-only behavior.
- [x] **Auto-refresh artifact panels** — Scratchpad now refreshes on `tool_execution_end` / `turn_end` / `agent_end` events (manual refresh still available).
- [x] **Working-folder file visibility** — Working-folder card now lists files and updates from runtime events.
- [ ] **Context panel usefulness** — surface active connectors/tools and task-referenced files, not just static copy.

## Later: Production

- [ ] **Auth end-to-end** — test OAuth `/login` flow, decide if it actually works through VM NAT
- [ ] **Multi-task runtime behavior** — define expected behavior for switching between active tasks without losing running session state (foreground/background semantics, status visibility, resume behavior).
- [ ] **Runtime download** — first-run pack download for non-dev users
- [ ] **Bundle pi** — include pi in runtime pack instead of copying from global npm
- [ ] **Onboarding** — first-run experience that doesn't require `mise run runtime-build`

## Later: Polish

- [ ] **Doc cleanup** — consolidate stale docs, kill anything that doesn't match reality
- [ ] **Code cleanup** — deep pass, remove slop, consistent patterns
- [ ] **Task title editing** — editable at top of conversation
- [ ] **Empty state polish** — shuffleable task categories like Cowork
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

- Harness primitives: `test-start`, `test-prompt`, `test-screenshot`, `test-set-folder`, `test-set-task`, `test-create-task`, `test-delete-tasks`, `test-dump-state`, `test-stop`, `test-open-preview`, `test-auth-*`, `test-send-login`, `test-set-auth-profile`, `test-check-permissions`
- Scope enforcement: `scripts/harness/path-i-lite-negative.sh`
- Rule: primitives only, no monolithic E2E scripts
