# Task Artifact Contract (MVP, pre-alpha)

Status: planned (contract agreed, implementation pending)
Owner: product/runtime
Last updated: 2026-02-06

## Decisions (locked)

1. **Working folder is immutable after task creation.**
   - Task creation may set `workingFolder` (or leave it null).
   - Existing tasks cannot change or clear `workingFolder`.
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

- `workingFolder` is validated at task creation.
- Any attempt to change `workingFolder` for an existing task is rejected.
- Task/session continuity remains tied to task id and `session.json`.
- No folder-change recycle flow for existing tasks.

## Implementation checklist

- [ ] Enforce immutability in backend task upsert path (reject folder edits for existing task id).
- [ ] Remove runtime folder-change apply path for active tasks.
- [ ] Update test harness semantics (`test-set-folder`) to create-new-task workflow or explicit rejection assertion.
- [ ] Add/standardize artifact paths under task storage:
  - [ ] `outputs/`
  - [ ] `uploads/`
- [ ] Ensure preview/list APIs aggregate `outputs` + `uploads` for Scratchpad.
- [ ] Enforce uploads read-only policy in task file operations.
- [ ] Update Right panel labels/copy/empty states to match the IA contract.
- [ ] Add harness evidence for contract:
  - [ ] folder-change rejection on existing task
  - [ ] scratchpad aggregation (`outputs` + `uploads`)
  - [ ] uploads write-denied behavior

## Notes

- No migration work is planned for pre-alpha.
- Existing local test data may be reset as needed during implementation.
