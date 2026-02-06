# TODO

## P0: MVP Definition

- [x] **Define MVP scope**: must-have flows for v0 (task create, run prompt, working folder)
- [x] **Auth/login decision**: require auth UI vs. auto-import from local pi
- [x] **Settings scope**: keep minimal settings or remove entirely for MVP
- [x] **First-run flow**: clarify what onboarding is required for MVP
  - source: `docs/mvp-definition.md`

## P0: Core Broken / Must Work

- [x] **Tasks**: Auto-create on first message, conversation persistence per task ✓
- [x] **Working folder UI**: Selection UI, recent folders dropdown, Tauri dialog ✓
- [x] **Runtime v2 pivot**: Replace restart-per-task-switch flow with persistent VM + task supervisor (`taskd`)
  - [x] Phase 0a: host runtime orchestration extracted from `MainView.svelte` into `runtimeService`
  - [x] Phase 0: feature flags + guardrails (`runtime_v2_taskd`, `runtime_v2_sync`)
  - [x] Harness visibility: `test-dump-state` includes runtime mode/flags
  - [x] Phase 1: guest `taskd` core with per-task processes and P0 RPC
  - [x] Phase 2: host v2 switch/prompt integration (ACK + `task_ready`, timeout, no v2 VM restart path)
- [x] **Per-task process isolation**: One pi process per task (`/sessions/<taskId>`, per-task Linux user deferred to hardening)
- [x] **Canonical session persistence**: Use `/sessions/<taskId>/session.json` for automatic resume
- [x] **No-reboot switching**: Implement `switch_task` path; task switch should not reboot VM
- [x] **Remove fallback hydration**: Delete transcript→session reconstruction from normal runtime path
- [x] **Task resume semantics**: Validate memory continuity + no cross-task context bleed (harness token-seed check in `v2_taskd` mode)
- [x] **Task switch latency target**: Warm/cold switch loop validated in v2 harness (no long spinner, switch/ready within target budget)
- [x] **MVP isolation pass (Path I-lite)**: enforce scoped writes on current runtime without full sandbox rewrite
  - [x] I1: Host + guest scope checks (`realpath`, traversal/symlink/special-file guards) + workspace-root/relative-path plumbing
  - [x] I1b: Ensure workspace mount reliability in v2 taskd path (inject 9p modules in initramfs + verified `/mnt/workdir` mount)
  - [x] I2: Negative harness tests (escape attempts + cross-task bleed)
  - [x] I3: ADR + UI copy for honest MVP guarantees (scoped local mode)
- [ ] **Gate G2 research lane (non-blocking)**: Gondolin vs deeper hardening path
  - [ ] G2-a: Gondolin feasibility spike (pi RPC, task switching, scoped writes, latency)
  - [ ] G2-b: Post-MVP hardening spike on current runtime (per-task users + stronger sandbox)
  - [ ] G2-c: Decision record update with selected post-MVP path

## P1: Production Ready

- [ ] **Login/auth**: Test OAuth flow + API key entry (host auth profiles are mounted into VM; end-to-end UX still unvalidated)
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
- **Target (v2):** Shared persistent VM + in-VM task supervisor (`taskd`) + one pi process per task
- **Canonical session target:** `/sessions/<taskId>/session.json` (no reconstruction)
- **Workspace target:** TBD by Gate G2 (`Path I` isolation-first, `Path G` Gondolin, `Path S` sync fallback)
- **Isolation target:** move from process-only isolation toward enforceable scope (per-task users + sandbox boundary)

## See Also

- `docs/runtime-v2-taskd-plan.md` - Runtime v2 baseline + Gate G2 reassessment
- `docs/runtime-g2-architecture-spike.md` - Isolation-first vs Gondolin decision gate
- `docs/adr/0001-runtime-g2-decision.md` - Decision record template for Gate G2
- `docs/research/cowork-claude-runtime-intel-2026-02-06.md` - captured Cowork/Claude sandbox observations
- `docs/ui-roadmap.md` - UI-specific roadmap with Cowork comparison
