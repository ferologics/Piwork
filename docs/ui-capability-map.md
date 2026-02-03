# UI Capability Map (Cowork‑style, normie‑first)

## Goal

Build a Cowork‑style UI on top of **pi**, focused on simple, safe, file‑based tasks for non‑technical users. Avoid Codex‑style “power user” features (worktrees, IDE integrations, automations) in v1.

## Core UX Pillars

1. **Task‑based workflow** (not just chat)
2. **Visible scope + permissions** (folder access is explicit)
3. **Transparent progress** (steps + commands)
4. **Artifacts / canvas** (real files, previewable)
5. **Low‑friction UI** (minimal jargon, safe defaults)

## UI Surfaces → Capability Requirements

### 1) Tasks List (left rail)

- Create/resume tasks
- Task status (queued/running/blocked/done/failed)
- Last activity time, short title
- Background tasks continue while browsing others

**Required capabilities**
- Persistent task metadata
- Task state transitions + updates
- Background execution support

### 2) Task View (main)

- Chat + streaming responses
- Inline tool output (collapsed by default)
- “What I’m doing” updates
- Abort / pause / resume
- Queue follow‑ups

**Required capabilities**
- Streaming tokens + tool events (SSE or WebSocket)
- Render incremental updates efficiently
- Queue control (steer vs follow‑up)

### 3) Progress / Steps Panel (right)

- Steps list with status (pending/running/done)
- Current action summary
- Visibility into commands (safe, readable)

**Required capabilities**
- Structured step events (derive from tool calls + model text)
- Collapse/expand raw command output

### 4) Context / Scope Panel (right)

- Selected folders (read/write scope)
- Connectors enabled
- Working files (recently touched)

**Required capabilities**
- Explicit scope model
- Mount list + file access control UI
- Connector permissions UI

### 5) Artifacts / Canvas Panel (right)

- Artifact list (generated/modified files)
- Preview selected artifact
- Open externally / export

**Required capabilities**
- File type detection + preview renderers
- Sandbox‑safe file access
- Canvas viewer for HTML/Markdown/Text/Images/CSV

### 6) Permission Prompts (modal)

- Destructive actions (delete/overwrite/move)
- Network access prompts
- Connector access prompts

**Required capabilities**
- Per‑action permission hooks
- “Allow once / always allow” choices

### 7) Settings / Safety

- Approval policy presets
- Network access default
- Sandbox status (VM OK / setup required)

**Required capabilities**
- Policy storage + surfaced status
- Clear, non‑technical labels

## MVP UI Requirements (no power‑user features)

- Task list + task view
- Folder picker + visible scope
- Streaming progress + tool logs
- Artifact list + preview
- Permission prompts
- Web search connector only

## Non‑Goals (v1)

- Worktrees
- Multi‑agent orchestration UI
- Automations / scheduling
- IDE integrations
- Advanced diff/merge tooling

## UI Stack Implications

**Minimum for MVP:**
- Streaming channel (SSE or WebSocket)
- Incremental UI updates (lists + logs)
- File preview components

This can be achieved with:
- **Server‑driven UI** (Maud + htmx + SSE)
- **Client app** (Svelte/React + WS)

Decision hinges on how rich the canvas/artifact UI needs to be in v1.

## Product Positioning (v1)

- **Cowork‑style knowledge work + light automation**.
- Support **small scripts / light programs** when needed.
- **Not** aiming to replace pro‑developer IDE workflows.
- Normie‑first UI, with progressive disclosure for power features.

## Open Questions

- Which artifact types must be first‑class on day 1?
- Should tool output be hidden by default for normies?
- Do we need “task templates” (simple skills) in v1?
- How much of the raw command log should be visible?
