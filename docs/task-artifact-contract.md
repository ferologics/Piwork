# Task Artifact Contract (MVP, pre-alpha)

Status: in progress
Owner: product/runtime
Last updated: 2026-02-06

## Decisions (locked)

1. **Working folder is one-time bind per task.**
   - Task creation may set `workingFolder` (or leave it null).
   - First bind is allowed for tasks that still have `workingFolder = null`.
   - Once set, existing tasks cannot change or clear `workingFolder`.
   - If user picked the wrong folder, create a new task.

2. **Scratchpad is always visible and task-local.**
   - Scratchpad is backed by task-local artifact directories.
   - Scratchpad contents persist across task switching and app restart.

3. **Artifact directories are explicit.**
   - `tasks/<taskId>/outputs` — generated artifacts (writable)
   - `tasks/<taskId>/uploads` — user-imported artifacts (read-only)

4. **Scratchpad UI aggregates both `outputs` and `uploads`.**
   - No visual distinction in MVP.
   - (Optional future enhancement: provenance badges/filters.)

5. **Write policy for MVP.**
   - Writable: task `workingFolder` (if set), `tasks/<taskId>/outputs`
   - Read-only: `tasks/<taskId>/uploads`

6. **Pre-alpha delivery policy.**
   - Breaking changes are acceptable.
   - No migration/fallback/compat shims required unless explicitly requested.

## Right panel IA contract (MVP)

- Replace card label "Downloads".
- Default card title: **Working folder** (when no folder is set).
- When folder is set, card title becomes folder basename (e.g. `pui`).
- Card body shows full path and empty state copy when unset.
- Scratchpad list is always visible and includes items from `outputs` + `uploads`.

## Runtime + host behavior contract

- `workingFolder` is validated whenever a bind is attempted.
- First bind is allowed only when a task has no folder yet.
- After first bind, any attempt to change/clear `workingFolder` is rejected.
- Task/session continuity remains tied to task id and `session.json`.

## Implementation checklist

- [x] Enforce immutability in backend task upsert path (reject folder edits for existing task id).
- [x] Restrict runtime folder-change apply path to first-bind only (`workingFolder = null -> path`).
- [x] Update test harness semantics (`test-set-folder`) for one-time bind + rejection behavior.
- [x] Add/standardize artifact paths under task storage:
  - [x] `outputs/`
  - [x] `uploads/`
- [x] Ensure preview/list APIs aggregate `outputs` + `uploads` for Scratchpad.
- [x] Enforce uploads read-only policy in task file operations (read-only source + best-effort permission lock).
- [x] Update Right panel labels/copy/empty states to match the IA contract.
- [ ] Add harness evidence for contract:
  - [x] folder-change rejection on existing task
  - [x] scratchpad aggregation (`outputs` + `uploads`)
  - [ ] opener action permission success (`Open in Finder` works in packaged UI)
  - [ ] first-write working-folder reliability (`/mnt/workdir` write appears on host without retry)
  - [ ] uploads write-denied behavior

## Notes

- No migration work is planned for pre-alpha.
- Existing local test data may be reset as needed during implementation.
