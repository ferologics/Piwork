# Folder + Artifact Implementation Plan

Status: archived
Owner: runtime/ui
Last updated: 2026-02-06
Superseded by: `../task-artifact-contract.md`, `../../TODO.md`
Archive note: core implementation landed; any remaining evidence follow-ups are tracked in the contract/TODO docs.

## Goals

- Enforce one-time task folder binding (`workingFolder`).
- Make folder picker CTA clear (`Work in a folder`) and lock it once set.
- Implement task-local artifact layout and Scratchpad aggregation.
- Keep runtime/task switching behavior deterministic.

## Locked behavior

1. `workingFolder` starts as `null` and can be set once (`null -> path`).
2. Once set, `workingFolder` is immutable for that task (`path -> anything` rejected).
3. Folder picker default label is **Work in a folder**.
4. Folder picker is non-interactive when active task already has a folder.
5. Scratchpad aggregates both:
   - `tasks/<taskId>/outputs` (writable)
   - `tasks/<taskId>/uploads` (read-only)

## Implementation steps

### 1) Backend invariants

- Enforce `workingFolder` immutability in `task_store::upsert_task`.
- Ensure artifact directories exist on task upsert:
  - `outputs/`
  - `uploads/`
- Add Rust tests for one-time bind + artifact dir creation.

### 2) Runtime folder-change behavior

- Keep folder selection for draft/no-task flow.
- Allow first bind for active tasks that still have `workingFolder = null`.
- Reject folder changes for active tasks with existing folder.
- Remove clear-folder flow for active tasks.

### 3) UI updates

- Folder picker default text: `Work in a folder`.
- Remove “No folder (chat only)” action.
- Lock picker interaction when active task already has folder.
- Right panel IA:
  - Replace “Downloads” semantics with Working folder card semantics.
  - Show dynamic title (folder basename when set, else “Working folder”).
  - Keep Scratchpad visible.

### 4) Scratchpad APIs

- Add task artifact list/read commands in Tauri backend.
- Aggregate `outputs` + `uploads` in Scratchpad listing.
- Use artifact preview path in right panel preview flow.

### 5) Harness + docs sync

- Update `test-set-folder` semantics for one-time bind behavior.
- Sync docs (`task-artifact-contract`, testing docs, TODO wording if needed).

### 6) Verification

- Run `mise run check`.
- Capture harness evidence for:
  - first bind success
  - second change rejection
  - Scratchpad aggregation
  - uploads write-denied behavior
