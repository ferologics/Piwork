# Permissions Model (MVP: Scoped Local Mode)

## Goals

- Keep the **VM boundary** as the base safety line.
- Enforce a practical **scoped local mode** for task file access.
- Stay honest about what is and is not hardened in MVP.

## Hard Boundary (MVP)

- A single **workspace root** is mounted for runtime operations.
- Each task is constrained to its selected **task folder** under that root.
- **Traversal/symlink escapes are blocked** by policy checks.
- This is **not** yet a hardened hostile-code sandbox.

## Permission Types (v1)

### File Operations

- **Write/Edit** → **no prompt** inside scope.
  - Changes are **summarized** in a Changes list.
- **Delete / Move / Rename** → prompt (always).

### Network / Connectors

- **Network is on by default**.
- **Web search** is **allowed without prompting**, but must be **visible** in UI:
  - Show **connector badge** in Context panel.
  - Provide **drill‑in panel** with queries + results.

- **Other connectors** (email, calendar, etc): prompt on first use.

## UI Behavior

- Permission prompts are **modal** and block task execution.
- Show **Allow once / Always allow / Deny**.
- Store decisions in a **policy file** scoped to:
  - Task
  - Folder
  - Tool type

## Change Review (v1)

- Track **created / modified / deleted** files per task.
- Show a **Changes** list with per‑file status.
- **Undo/restore** is a **future enhancement** (not required for v1).

## Policy Storage (v1)

- Store per‑user policy on host (not inside VM).
- Policy applies **only to the current machine**.
- Allow clearing/resetting in Settings.

## Open Questions

- Do we allow “Always allow” for delete/move actions?
- How granular should “Always allow” be (per folder, per task, per tool)?
- Should web search be explicitly toggled in Settings?
