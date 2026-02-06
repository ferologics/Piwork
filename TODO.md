# TODO

## Now: Foundation cleanup

- [x] **Kill v1 runtime** — remove `PIWORK_RUNTIME_V2_TASKD` flag, v1 code paths in runtimeService (`handleTaskSwitchV1`, `handleFolderChangeV1`, `ensureTaskSessionReady`), v1 `nc -l` loop in init script, `RuntimeMode` type. taskd is the only runtime.
- [x] **Rename v2_taskd → runtime** — drop "v2" prefix everywhere (types, logs, flags, docs)
- [x] **Extract init script** — move the heredoc out of `mise-tasks/runtime-build` into `runtime/init.sh`
- [x] **Fix context pollution** — infrastructure bash commands (grep mount check, mkdir, session writes) go through pi's RPC and pollute the agent's conversation. Add `system_bash` to taskd that bypasses pi sessions, or do checks in taskd before spawning pi.
- [ ] **Simplify auth/settings** — strip Settings modal to: show current auth status + "Import from pi" button. Kill multi-profile UI. For MVP: baked auth or `~/.pi/agent/auth.json` import.
- [ ] **Clarify folder-change semantics** — define expected behavior when changing a task’s working folder (especially for already-open tasks), then make runtime behavior match.
- [ ] **Define task artifact persistence contract** — document where task-created files live with/without a working folder, and what should persist across switch/restart.
- [ ] **Untangle auth state from runtime artifacts** — keep auth storage purpose clear; avoid mixing credentials with unrelated pi/session artifacts.
- [ ] **Fix sendLogin optimistic log** — logs `[info] Sent /login` even if not connected
- [ ] **Delete remaining slop** — review docs for stale references to v1, v2 flags, sync protocol, smoke suites
- [ ] **Dev watch scope** — avoid restarting `tauri dev` for non-runtime docs/content edits (e.g. Markdown), keep hot reload scoped to relevant source/config files.
- [ ] **Roadmap sync hygiene** — keep `docs/ui-roadmap.md` aligned with `TODO.md` (directional vs execution items, avoid stale/contradictory status).

## Next: Make it usable

- [ ] **Markdown rendering** — render agent responses (bold, lists, code blocks). Biggest UX gap.
- [ ] **Tool call display** — collapsible "Created a file ›", "Ran command ›" in message stream
- [ ] **Right panel IA pass** — separate Working folder and Scratchpad sections (collapsible), include clear empty states, and add quick open-in-Finder affordance where relevant.
- [ ] **Scratchpad continuity** — keep scratchpad artifacts visible even after setting/changing a task working folder (don’t make prior task files appear to disappear).
- [ ] **Artifact explorer parity** — make file listing/preview behavior consistent across working-folder tasks and no-folder scratch tasks.
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
