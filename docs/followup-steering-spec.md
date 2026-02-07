# Follow-up + Steering Composer Spec (deferred)

## Status

Draft for future implementation. Not part of current P0 foundation cleanup.

## Why this exists

We currently block prompt sending while a turn is in flight to avoid duplicate/fragmented message rendering races.

That fix is correct for now, but it removes an important UX capability: users cannot steer the active turn or queue a follow-up while the agent is working.

This doc captures a future interaction model that restores that capability without reintroducing duplicate-send bugs.

## Goals

1. Allow users to add intent while a turn is running.
2. Keep one active runtime prompt at a time (no concurrent prompt lane).
3. Make interrupt/stop explicit and fast.
4. Keep message ordering deterministic and testable.

## Non-goals (for first pass)

- Full multi-turn planning UI
- Branching conversations
- Cross-task/global queues

## Terms

- **Active turn**: the currently running agent response.
- **Follow-up message**: a queued message that runs after the active turn finishes.
- **Steering message**: a high-priority message intended to redirect the active turn.
- **Queue**: pending user messages for the active task, persisted in UI state.

## Interaction spec

### Idle (no active turn)

- `Enter` → send immediately.
- `Option+Enter` → same as send immediately (no queue needed when idle).
- Send button → normal send action.

### Running (active turn in progress)

- `Enter` → **steering message** behavior:
  - enqueue as `mode: steering`
  - trigger stop/interrupt of the active turn
  - dispatch steering message first once runtime is ready
- `Option+Enter` → **follow-up message** behavior:
  - enqueue as `mode: followup`
  - do not interrupt active turn
- `Option+Up` → pop most recent queued message back into composer editor (LIFO recall for quick edits).
- `Escape` → stop/interrupt active turn.
- Send button becomes a **Stop** button while running (with loading animation).

## Queue rules

- Queue is task-scoped.
- Ordering:
  - steering messages have priority over follow-ups
  - within same mode, FIFO
- Queue item shape (proposed):

```ts
{
    id: string;
    text: string;
    mode: "steering" | "followup";
    createdAt: string;
}
```

- If stop fails for a steering message, keep it queued and surface a non-blocking error.

## Runtime/API implications

To make steering reliable, add an explicit interrupt lane rather than abusing `stop_task`:

- Host → taskd command (proposed): `stop_prompt`
  - payload: `{ taskId?: string, reason?: "user_stop" | "steer" }`
- taskd → host event (proposed): `prompt_stopped`
  - payload includes reason and task id
- `agent_end` should include/forward end reason when available (`complete`, `stopped`, `error`).

Follow-up queueing can ship before this API if we only dispatch on natural `agent_end`.

## UI notes

- While running, show:
  - stop button in composer action slot
  - queued count chip (e.g. `Queued 2`)
- Optional later: mini queue list in composer footer (last 1–3 items with remove/edit affordance).

## Suggested rollout

### Phase 1 — Safe queueing (no interrupt yet)

- `Option+Enter` queues follow-up messages.
- Auto-dispatch next queued message on `agent_end`.
- Keep regular `Enter` blocked while running.

### Phase 2 — Stop controls

- Add Stop button + `Escape` shortcut.
- Wire to `stop_prompt` RPC.

### Phase 3 — Steering semantics

- `Enter` while running becomes steering (interrupt + priority queue).
- `Option+Up` recall from queue.

## Testing requirements

Add `state_snapshot` fields for deterministic tests:

- `composer.queueLength`
- `composer.hasSteeringQueued`
- `composer.stopVisible`

Regression coverage to add:

1. No duplicate assistant messages when queueing during streaming.
2. Follow-up dispatch order is deterministic.
3. Steering interrupts current turn and executes before follow-ups.
4. `Escape` and Stop button are equivalent.
5. `Option+Up` recall removes item from queue and restores editor text.

## Open questions

1. Should `Option+Enter` be configurable per platform/layout?
2. Should `Enter` while running default to steering or follow-up for first release?
3. Should queue survive app restart (probably yes, task-scoped, small cap)?

## Revisit trigger

Revisit after current “Make it usable” priorities land (Markdown rendering + tool-call display), then decide whether this becomes the next composer UX milestone.
