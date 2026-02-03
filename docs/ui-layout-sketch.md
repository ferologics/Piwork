# UI Layout Sketch (v1)

> Cowork‑style, normie‑first UI on top of pi.

## Layout Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ Top bar: App name • Task status • Safety / Network indicator • Settings     │
├───────────────┬──────────────────────────────────────────┬──────────────────┤
│ Tasks (left)  │ Task View (main)                          │ Side Panel (right)│
│               │                                          │ Tabs:             │
│ • New Task    │ ┌──────────────────────────────────────┐ │ • Progress        │
│ • Task A      │ │ Chat transcript + streaming output   │ │ • Artifacts       │
│ • Task B      │ │                                      │ │ • Context         │
│ • Task C      │ └──────────────────────────────────────┘ │ • Permissions     │
│               │ ┌──────────────────────────────────────┐ │                  │
│               │ │ Composer (prompt + attachments)      │ │                  │
│               │ └──────────────────────────────────────┘ │                  │
└───────────────┴──────────────────────────────────────────┴──────────────────┘
```

## UI Surfaces

### 1) Tasks (Left Rail)

- New task button
- Task list with status chips (queued/running/blocked/done/failed)
- Last activity + short title

### 2) Task View (Main)

- Conversational transcript
- Streaming assistant output
- Inline tool logs (collapsed by default)
- Abort / pause / resume
- Queue follow‑ups (steer vs follow‑up hidden under “More”)
- Composer includes **Work in a folder** toggle + attachments + model selector

### 3) Side Panel (Right)

**Tabs (active task):**

- **Progress**: todo‑style step list + current action
- **Artifacts**: generated files with preview
- **Context**: selected folders + connectors + working files/changes
- **Permissions**: pending approvals + history

**Empty state:** stacked cards for Progress / Working folder / Context

## Core States

- **Empty state**: “Pick a folder to start” + quick‑start cards + suggestions dropdown
  - Organize Downloads
  - Receipts → Spreadsheet
  - Notes → Summary Report
  - Images → PDF
- **Setup required** (desktop): QEMU not installed / missing accel
- **Running**: streaming + steps updating
- **Blocked**: waiting for approval
- **Completed**: summary + artifacts highlight

## Canvas / Artifact Preview

- Embedded preview for **HTML, Markdown, text, images, CSV**
- “Open in external app” + “Export”
- First‑class for HTML (Cowork‑style artifacts)

## Data Model (minimal)

```ts
Task {
    id: string
    title: string
    status: "queued" | "running" | "blocked" | "done" | "failed"
    createdAt: number
    updatedAt: number
    scope: Scope
    connectors: ConnectorStatus[]
    steps: Step[]
    artifacts: Artifact[]
    messages: Message[]
    permissions: PermissionRequest[]
}

Scope {
    folders: ScopeMount[]
    readOnly: boolean
}

ScopeMount {
    path: string
    mode: "read" | "write"
    grantedAt: number
    persistent: boolean
}

Step {
    id: string
    label: string
    status: "pending" | "running" | "done" | "failed"
    startedAt?: number
    endedAt?: number
    toolCallId?: string
}

Artifact {
    id: string
    path: string
    type: "html" | "markdown" | "text" | "image" | "csv" | "unknown"
    createdAt: number
    updatedAt: number
}

PermissionRequest {
    id: string
    type: "write" | "delete" | "network" | "connector"
    detail: string
    decision?: "allow_once" | "allow_always" | "deny"
    createdAt: number
}
```

## Event Mapping (pi RPC → UI)

- `message_update` (text deltas) → streaming transcript
- `tool_execution_start/update/end` → step creation + status updates
- `extension_ui_request` → permission prompt modals
- `agent_end` → mark task done + summary highlight

## Normie‑First Defaults

- Hide raw commands by default (expandable)
- Show plain‑language action summaries
- Safe approvals with “Allow once / Always allow”
- Visible scope banner (“Access: 1 folder, 1 connector”)
