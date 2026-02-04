# Piwork

Cowork‑style, normie‑first UI on top of **pi**, built with **Tauri**.

## Status

Working prototype with VM-based sandbox. See `AGENTS.md` for architecture details.

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

```bash
mise run test
```

```bash
mise run test-vite
mise run test-rust
```

### Cleanup

```bash
mise run clean        # remove build artifacts
mise run clean-deep   # remove build artifacts + node_modules
mise run reset        # clean-deep + setup
```

### Rust build cache

Rust builds use **sccache** via `.cargo/config.toml`.

## Assets

- `assets/logo.svg` is the source for app icons.
- Regenerate with `mise run icons`.

## Docs

- `AGENTS.md` - AI-focused project context and architecture
- `TODO.md` - roadmap and task tracking
- `docs/runtime-pack.md` - VM runtime format
- `docs/pi-integration.md` - RPC protocol
- `docs/auth-flow.md` - authentication flow
- `docs/permissions-model.md` - folder access model
- `docs/research/` - Cowork observation notes, UI sketches
