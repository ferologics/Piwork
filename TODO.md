# TODO

## Next Up

- [x] Layout skeleton (left rail, main view, right tabs)
- [ ] Define **task persistence** storage format + location
- [ ] Implement **TaskStore** + persistence (task.json)
- [ ] Implement **RpcClient** interface + **MockRpcClient** + JSONL fixtures
- [ ] Plan **full auth UI** (pi `/login` + API key entry)

## VM / Runtime Setup

- [x] Runtime setup-required UI (manifest check)
- [ ] QEMU detection + setup-required mode
- [ ] Runtime pack download + install flow
- [ ] Hardware accel check (HVF on macOS)
- [ ] virtio-serial RPC bridge
- [ ] Folder mount UI (scope selection)
- [ ] Permission-gate extension for VM

## Later

- [ ] Artifact preview (HTML, Markdown, images, CSV)
- [ ] Canvas viewer component
- [ ] Connector badges (web search visibility)
- [ ] Explore MITM network mode (virtio‑net + stream netdev + host JS Ethernet stack)
- [ ] MITM integration: host stack in runtime pack + TCP proxy + allowlist policy
- [ ] MITM integration: TLS MITM (CA install) + pinning fallbacks
- [ ] MITM integration: UI controls (network mode toggle, allowlist, audit log)
