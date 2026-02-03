# Canvas / Artifacts Deep Dive (Draft)

## Goal

Define what “canvas” means in this product and what artifact types we must support in v1. Artifacts should feel like **real files** produced by the agent, not just chat text.

## Terminology

- **Artifact**: Any file the agent creates or modifies.
- **Canvas**: The in‑app preview surface for artifacts.

## Capability Levels

### Level 0: View‑only (v1 baseline)

- Preview common file types
- Open in external app
- Export / save to user location

### Level 1: Lightweight edits

- Rename, duplicate, delete (with confirmation)
- Small text edits for Markdown / text

### Level 2: Rich editing

- HTML preview with live reload
- Markdown editor with preview split
- CSV table viewer/editor

### Level 3: Interactive artifacts

- Run HTML/JS in a sandboxed iframe
- Allow user interaction in‑app
- Optional network access gating

## Artifact Types (Candidate List)

**Must‑have (v1)**
- HTML
- Markdown
- Text
- Images (PNG/JPG/GIF)
- CSV (preview as table)

**Nice‑to‑have (v1.5)**
- PDF (view only)
- Audio (playback)
- JSON (pretty view)

**Later**
- Office docs (docx/xlsx/pptx)
- Video

## Safety Considerations

- Treat artifacts as **untrusted content**.
- HTML should render in a **sandboxed iframe** with restricted permissions.
- Network access for HTML artifacts should be **off by default**.
- Clear warnings for artifacts that include scripts.

## UX Ideas

- Artifacts list with type icons + timestamps
- Preview panel in the right column
- “Open in…” and “Export” actions
- Highlight newest artifact after task completion

## Open Questions

- Should HTML artifacts be allowed to execute JavaScript in‑app?
- If yes, should network be allowed or blocked by default?
- Should artifacts be editable in v1 or view‑only?
- Which artifact types are critical for launch?
