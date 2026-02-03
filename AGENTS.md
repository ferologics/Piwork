# AGENTS.md — PUI

## Project Goal

Build a Cowork‑style, normie‑first UI on top of **pi** using **Tauri**. Focus on file‑scoped tasks, progress visibility, and artifacts/canvas previews.

## Stack (current)

- **Tauri 2**
- **SvelteKit** (template from create‑tauri‑app)
- **pnpm**
- **Tailwind 4 + shadcn‑svelte**
- **Testing:** Vitest (RPC mock; Playwright deferred)

## Key Decisions

- Desktop runtime = **QEMU runtime pack**, **fresh VM per task**.
- **virtio‑serial** for RPC (no vsock).
- **Network on by default** via NAT (SLIRP).
- **No write/edit prompts**; track changes list instead.
- **Delete/move/rename prompts** only.
- **Tasks are resumable across restarts** (store session file + mounts).

## Docs to reference

- `docs/ui-layout-sketch.md`
- `docs/ui-capability-map.md`
- `docs/permissions-model.md`
- `docs/runtime-pack.md`
- `docs/pi-integration.md`
- `docs/auth-flow.md`

## Conventions

- 4‑space indentation
- Keep configs sorted when reasonable
- Prefer clarity over cleverness
