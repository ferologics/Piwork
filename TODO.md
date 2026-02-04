# TODO

## P0: Core Broken / Must Work

- [ ] **Tasks**: New Task button, task switching, conversation persistence (IN PROGRESS)
- [ ] **Task resume**: Select task from list → resume VM session with that conversation
- [ ] **Working folder**: Selection UI + mount into VM + show files responsively

## P1: Production Ready

- [ ] **Login/auth**: Test OAuth flow + API key entry (currently just copies from local pi config)
- [ ] **Runtime download**: First-run pack download + updates (non-dev flow)
- [ ] **Bundle pi**: Include pi in runtime pack instead of copying from global npm
- [ ] **Bundle skills?**: Maybe include useful skills in runtime
- [ ] **Onboarding polish**: Make first-run experience smooth

## P2: Cleanup

- [ ] **Doc cleanup**: Consolidate/remove stale docs, there's a mess
- [ ] **Code cleanup**: Deep pass over all code, remove slop, consistent patterns
- [ ] **Settings audit**: Current settings is "vibeslopped" - review what's needed

## P3: Later

- [ ] **Cross-platform**: Linux/Windows support
- [ ] **MITM network**: Proxy for visibility/control (virtio-net + stream netdev)
- [ ] **Artifact preview**: HTML, Markdown, images, CSV in-app
- [ ] **Canvas viewer**: Rich artifact display
- [ ] **Connector badges**: Web search visibility in Context panel
- [ ] **qcow2 rootfs**: Lower RAM usage option

## Testing Infrastructure

- [x] Dev mise tasks (`dev-start`, `dev-prompt`, `dev-screenshot`, `dev-logs`, `dev-stop`)
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

## See Also

- `docs/ui-roadmap.md` - UI-specific roadmap with Cowork comparison
