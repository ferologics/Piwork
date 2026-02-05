# TODO

## P0: MVP Definition

- [ ] **Define MVP scope**: must-have flows for v0 (task create, run prompt, working folder)
- [ ] **Auth/login decision**: require auth UI vs. auto-import from local pi
- [ ] **Settings scope**: keep minimal settings or remove entirely for MVP
- [ ] **First-run flow**: clarify what onboarding is required for MVP

## P0: Core Broken / Must Work

- [x] **Tasks**: Auto-create on first message, conversation persistence per task ✓
- [x] **Working folder UI**: Selection UI, recent folders dropdown, Tauri dialog ✓
- [ ] **Runtime v2 pivot**: Replace restart-per-task-switch flow with persistent VM + task supervisor (`taskd`)
- [ ] **Per-task process isolation**: One Linux user + one pi process per task (`/sessions/<taskId>`)
- [ ] **Canonical session persistence**: Use `/sessions/<taskId>/session.json` for automatic resume
- [ ] **No-reboot switching**: Implement `switch_task` path; task switch should not reboot VM
- [ ] **Remove fallback hydration**: Delete transcript→session reconstruction from normal runtime path
- [ ] **Task resume semantics**: Validate memory continuity + no cross-task context bleed
- [ ] **Task switch latency target**: Warm switch completes in a few seconds, no long spinner
- [ ] **Task workspace model**: Ship sync-first workspace (`/sessions/<taskId>/work`), evaluate live mount later

## P1: Production Ready

- [ ] **Login/auth**: Test OAuth flow + API key entry (currently just copies from local pi config)
- [ ] **Runtime download**: First-run pack download + updates (non-dev flow)
- [ ] **Bundle pi**: Include pi in runtime pack instead of copying from global npm
- [ ] **Bundle skills?**: Maybe include useful skills in runtime
- [ ] **Markdown rendering**: Render agent responses with markdown (bold, lists, code)
- [ ] **Onboarding polish**: Make first-run experience smooth

## P2: Cleanup

- [ ] **Doc cleanup**: Consolidate/remove stale docs, there's a mess
- [ ] **Code cleanup**: Deep pass over all code, remove slop, consistent patterns
- [ ] **Settings audit**: Current settings is "vibeslopped" - review what's needed

## P3: Connectors

- [ ] **Research Cowork connectors**: What integrations does Cowork offer? (Calendar, Slack, Google Drive, Notion, etc.)
- [ ] **Implement basic connectors**: Start with most useful ones
  - [ ] Calendar (Google Calendar / Apple Calendar) - for "prep for a meeting" tile
  - [ ] File storage (Google Drive / Dropbox / iCloud) - for file access
  - [ ] Communication (Slack / Email) - for "draft a message" tile
  - [ ] Notes (Notion / Apple Notes) - for context/reference

## P4: Later

- [ ] **Import external files**: Attach files from outside working folder (copy in? read-only mount?)
- [ ] **Clipboard + attachments**: Support images/files from clipboard with MIME-aware previews in chat
- [ ] **Multi-folder tasks**: Mount multiple folders per task (read-only extras?)
- [ ] **VM per task**: Full isolation option for paranoid mode
- [ ] **Cross-platform**: Linux/Windows support
- [ ] **MITM network**: Proxy for visibility/control (virtio-net + stream netdev)
- [ ] **Artifact preview**: HTML, Markdown, images, CSV in-app
- [ ] **Canvas viewer**: Rich artifact display
- [ ] **Connector badges**: Web search visibility in Context panel
- [ ] **qcow2 rootfs**: Lower RAM usage option

## Testing Infrastructure

- [x] AI test harness (`test-start`, `test-prompt`, `test-screenshot`, `test-logs`, `test-stop`)
- [ ] Screenshot-based verification (works, blocked on accessibility for interaction)
- [ ] Custom test harness with `--test-mode` flag
- [ ] Proper e2e with Playwright + tauri-driver (CI/CD)

## Done

- [x] Layout skeleton (left rail, main view, right tabs)
- [x] Task persistence (TaskStore + task.json)
- [x] RpcClient interface + MockRpcClient
- [x] Auth UI (pi `/login` + API key entry)
- [x] Runtime setup-required UI
- [x] QEMU detection + HVF check
- [x] VM RPC bridge (TCP port forwarding, READY via serial console)
- [x] pi running inside VM with real RPC protocol
- [x] Consolidated runtime build (`mise run runtime-build`)
- [x] VM networking (CA certs + DNS for HTTPS)
- [x] Empty state with quick-start tiles (Cowork-style)
- [x] Right panel collapsed by default
- [x] Removed dev-focused "RPC output" header
- [x] Dev mise tasks

## Architecture Decisions

**Task isolation model (transition):**

- **Current (v1 temporary):** Shared VM, restart-heavy task switching, fallback hydration when task-state mount is missing
- **Target (v2):** Shared persistent VM + in-VM task supervisor (`taskd`) + one pi process per task user
- **Canonical session target:** `/sessions/<taskId>/session.json` (no reconstruction)
- **Workspace target:** `/sessions/<taskId>/work` with sync-first host integration
- **Isolation target:** task-level Unix user/process boundaries, no cross-task memory bleed

## See Also

- `docs/runtime-v2-taskd-plan.md` - Full pivot plan for no-reboot task switching
- `docs/ui-roadmap.md` - UI-specific roadmap with Cowork comparison
