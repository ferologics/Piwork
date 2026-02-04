# TODO

## Next Up

- [ ] Fix empty message bubbles (message content not rendering)
- [ ] Folder mount UI (scope selection)
- [ ] Permission-gate extension for VM
- [ ] Runtime pack download + install flow (non-dev)

## Testing Infrastructure

- [ ] **Quick testing**: Screenshot-based verification (`screencapture` + image inspection)
  - Works now for visual verification
  - Blocked on accessibility permissions for interaction (cliclick/AppleScript)
- [ ] **Custom test harness**: Add `--test-mode` flag to app
  - Expose IPC commands to query UI state (what messages are shown, etc.)
  - Allow injecting user input via IPC (simulate typing/sending)
  - Dump conversation state to file for inspection
- [ ] **Proper e2e (Playwright + tauri-driver)**: 
  - Tauri has WebDriver support via `tauri-driver`
  - Playwright can automate, screenshot, wait for elements, assert DOM
  - More setup but enables CI/CD testing

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
- [x] Dev mise tasks (`dev-start`, `dev-prompt`, `dev-screenshot`, `dev-logs`, `dev-stop`)

## Later

- [ ] pi distribution: bundle pi in runtime pack instead of copying from global npm
- [ ] Cross-platform VM testing (Linux/Windows via Parallels or similar)
- [ ] Explore rootfs disk image (qcow2) for lower RAM usage
- [ ] Artifact preview (HTML, Markdown, images, CSV)
- [ ] Canvas viewer component
- [ ] Connector badges (web search visibility)
- [ ] MITM network mode (virtio-net + stream netdev + host stack)
- [ ] MITM: TCP proxy + allowlist policy
- [ ] MITM: TLS interception (CA install) + pinning fallbacks
- [ ] MITM: UI controls (network mode toggle, allowlist, audit log)

