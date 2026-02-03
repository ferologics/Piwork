# Piwork

Cowork‑style, normie‑first UI on top of **pi**, built with **Tauri**.

## Status

Early planning + scaffold. See `docs/` for product and runtime notes.

## Stack

- Tauri 2
- SvelteKit
- pnpm
- Tailwind 4 + shadcn‑svelte
- mise (task runner)

## Development

```bash
mise run setup
mise run tauri-dev
```

```bash
mise run check
```

### Rust build cache

Rust builds use **sccache** via `.cargo/config.toml`.

## Assets

- `assets/logo.svg` is the source for app icons.
- Regenerate with `mise run icons`.

## Docs

- `docs/ui-layout-sketch.md`
- `docs/ui-capability-map.md`
- `docs/permissions-model.md`
- `docs/runtime-pack.md`
- `docs/pi-integration.md`
