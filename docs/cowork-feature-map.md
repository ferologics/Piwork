# Cowork Signals → PUI Feature Map

## What users love about Cowork (signals)

- **Task‑based workflow**: long‑running, multi‑step tasks that feel like delegation.
- **Folder‑scoped access**: pick a folder, clear trust boundary.
- **VM isolation + approvals**: strong safety story while still powerful.
- **Transparent progress**: visible steps and running commands.
- **Artifacts panel**: generated files are visible, previewable, and actionable.
- **Connectors / web access**: optional, permission‑gated external access.
- **Normie‑friendly UI**: no terminal; approachable defaults.

## PUI Parity Checklist (v1 targets)

- **Tasks list** (left rail): create, resume, status, last activity.
- **Task view** (main): chat + streaming output + tool logs.
- **Progress panel**: step list with status + current action.
- **Context panel**: selected folders, connectors, working files.
- **Artifacts panel**: list + preview + open/export.
- **Permission prompts**: deletes/moves, connectors (writes are reviewed via changes).
- **Queueing**: allow multiple tasks and background execution.
- **Safety defaults**: explicit scope + visible approvals.

## Canvas / Artifacts (explicit support)

- **Canvas view**: rich artifact preview inside the app.
- **Supported types** (v1): HTML, Markdown, text, images, CSV tables.
- **Open in external app**: system default (browser/editor).
- **Download/export**: save artifact to user‑chosen path.
- **Future**: in‑app editing + diff view + side‑by‑side comparisons.

## MVP Scope Proposal

- Task creation + folder selection.
- QEMU runtime pack install (desktop) + setup‑required flow.
- pi via RPC (streaming tokens + tool events).
- Artifact listing + preview (HTML/Markdown/Text).
- Permission gating for network + destructive file ops.
- Web search connector only (optional) to start.

## Phase 2+ Ideas

- Connector marketplace (Google Drive/Notion/GitHub).
- Canvas editing + diff/patch workflows.
- Plugin system (skills + commands bundles).
- Cross‑device session sync.

## Open Questions

- Which artifact types must be first‑class in v1?
- Should tasks be resumable across app restarts by default?
- What is the minimum connector set to feel useful?
