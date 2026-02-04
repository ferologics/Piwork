# TODO

## Next Up

- [ ] Folder mount UI (scope selection)
- [ ] Permission-gate extension for VM
- [ ] Runtime pack download + install flow (non-dev)

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
