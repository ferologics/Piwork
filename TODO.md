# TODO

## Next Up

- [x] Layout skeleton (left rail, main view, right tabs)
- [x] Define **task persistence** storage format + location
- [x] Implement **TaskStore** + persistence (task.json)
- [x] Implement **RpcClient** interface + **MockRpcClient** + JSONL fixtures
- [x] Plan **full auth UI** (pi `/login` + API key entry)

## VM / Runtime Setup

- [x] Runtime setup-required UI (manifest check)
- [x] QEMU detection + setup-required mode
- [ ] Runtime pack download + install flow
- [x] Hardware accel check (HVF on macOS)
- [x] virtio-serial RPC bridge (READY handshake + JSONL stream)
- [ ] Run pi inside VM + real RPC protocol (dev boot install path in initramfs)
- [ ] Folder mount UI (scope selection)
- [ ] Permission-gate extension for VM

## Later

- [ ] Explore rootfs disk image runtime pack (Option B) + qcow2 overlays for production
- [ ] Artifact preview (HTML, Markdown, images, CSV)
- [ ] Canvas viewer component
- [ ] Connector badges (web search visibility)
- [ ] Explore MITM network mode (virtio‑net + stream netdev + host JS Ethernet stack)
- [ ] MITM integration: host stack in runtime pack + TCP proxy + allowlist policy
- [ ] MITM integration: TLS MITM (CA install) + pinning fallbacks
- [ ] MITM integration: UI controls (network mode toggle, allowlist, audit log)
