# Permissions Model (Draft)

## Goals

- Keep the **VM boundary** as the hard safety line.
- Use **clear, minimal prompts** for risky actions.
- Mirror Cowork: **silent web search**, but visible connector context.

## Hard Boundary (always on)

- Only **user‑selected folders** are mounted into the VM.
- Everything else on the host is invisible.

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
