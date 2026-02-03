# UI Setup (Decision Draft)

## Goal

Document the UI stack decision before implementation. Focus on a Cowork‑style, normie‑first app with streaming, task panels, permissions, and artifact previews.

## Requirements

- Multi‑panel layout (tasks, main view, side tabs)
- Streaming updates (tokens + tool events)
- Permission prompts (modal/dialog)
- Artifact previews (HTML/Markdown/Text/Image/CSV)
- Resizable panes and status chips
- Tauri‑friendly (desktop now, mobile later)

## UI Decisions (v1)

- **Right panel uses tabs**: Progress / Artifacts / Context / Permissions
- **Empty state uses stacked cards** (Progress / Working folder / Context)

## Candidate Stacks

### Option A: Svelte + Tailwind + shadcn‑svelte

**Pros**
- Rich UI primitives (tabs, dialogs, badges) with low friction
- Excellent for streaming + complex state
- Easy to theme + customize

**Cons**
- Heavier setup than PicoCSS
- Tailwind learning curve for contributors

### Option B: Svelte + PicoCSS

**Pros**
- Minimal setup, fast MVP
- Clean defaults for forms/typography

**Cons**
- Missing components (tabs, dialogs, panels)
- Custom CSS work grows fast for this UI

### Option C: Maud + htmx + PicoCSS

**Pros**
- Server‑driven UI, minimal JS
- Fast iteration for simple screens

**Cons**
- Streaming + complex panels quickly become custom JS anyway
- Harder to build rich artifact/canvas views

### Option D: Rust‑native UI (Dioxus / Iced / Slint)

**Pros**
- Single language (Rust)
- No web stack

**Cons**
- Slower iteration for complex UX
- Ecosystem not as mature for web‑style UI

## Provisional Direction

Leaning toward **Option A (Svelte + Tailwind + shadcn‑svelte)** to avoid a migration later when the UI grows (tabs, modals, resizable panes, artifact previews). Decision is open until artifact/canvas requirements are clearer.

## Open Questions

- Do we want a full design system now, or keep it minimal and evolve?
- Should we align with a specific theme (e.g., Rose Pine), or keep neutral?
- How much JavaScript are we comfortable with in v1?

## Next Steps

1. Deep‑dive **Artifacts / Canvas** requirements (separate doc).
2. Re‑validate stack choice after artifact requirements are clear.
3. Iterate on layout sketch + panel behavior.
