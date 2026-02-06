# TODO

## Now: Foundation cleanup

- [ ] **Kill v1 runtime** — remove `PIWORK_RUNTIME_V2_TASKD` flag, v1 code paths in runtimeService (`handleTaskSwitchV1`, `handleFolderChangeV1`, `ensureTaskSessionReady`), v1 `nc -l` loop in init script, `RuntimeMode` type. taskd is the only runtime.
- [ ] **Rename v2_taskd → runtime** — drop "v2" prefix everywhere (types, logs, flags, docs)
- [ ] **Extract init script** — move the heredoc out of `mise-tasks/runtime-build` into `runtime/init.sh`
- [ ] **Fix context pollution** — infrastructure bash commands (grep mount check, mkdir, session writes) go through pi's RPC and pollute the agent's conversation. Add `system_bash` to taskd that bypasses pi sessions, or do checks in taskd before spawning pi.
- [ ] **Simplify auth/settings** — strip Settings modal to: show current auth status + "Import from pi" button. Kill multi-profile UI. For MVP: baked auth or `~/.pi/agent/auth.json` import.
- [ ] **Fix sendLogin optimistic log** — logs `[info] Sent /login` even if not connected
- [ ] **Delete remaining slop** — review docs for stale references to v1, v2 flags, sync protocol, smoke suites

## Next: Make it usable

- [ ] **Markdown rendering** — render agent responses (bold, lists, code blocks). Biggest UX gap.
- [ ] **Tool call display** — collapsible "Created a file ›", "Ran command ›" in message stream
- [ ] **File list in right panel** — show files agent created/modified in task folder
- [ ] **Artifact/file preview** — open files in main split pane (text + image)

## Later: Production

- [ ] **Auth end-to-end** — test OAuth `/login` flow, decide if it actually works through VM NAT
- [ ] **Runtime download** — first-run pack download for non-dev users
- [ ] **Bundle pi** — include pi in runtime pack instead of copying from global npm
- [ ] **Onboarding** — first-run experience that doesn't require `mise run runtime-build`

## Later: Polish

- [ ] **Doc cleanup** — consolidate stale docs, kill anything that doesn't match reality
- [ ] **Code cleanup** — deep pass, remove slop, consistent patterns
- [ ] **Task title editing** — editable at top of conversation
- [ ] **Empty state polish** — shuffleable task categories like Cowork

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
