# Testing Strategy (Draft)

## Goals

- Fast feedback for UI state changes.
- Ability to **mock full agent conversations** without a VM.
- Confidence in core flows (task creation, progress, artifacts, permissions).

## Tooling

- **Unit / component / flow**: Vitest + @testing-library/svelte
- **Type checks**: svelte-check
- **E2E**: deferred (optional later)

## RPC Mock Harness

Create a **mock RPC server** that replays JSONL fixtures into the UI.

- `src/lib/__tests__/fixtures/rpc/*.jsonl`
- Each fixture is a full transcript (prompt → tool calls → events)

The UI subscribes to a `RpcClient` interface. Tests swap in a **MockRpcClient**.

### MockRpcClient (concept)

- `connect()` → no‑op
- `send(command)` → returns canned responses
- `subscribe(listener)` → streams fixture events with controlled timing

## Suggested Test Cases

1. **Happy path**: task runs, steps update, artifacts appear.
2. **Permission prompt**: delete/move request blocked/allowed.
3. **Web search**: connector badge + drill‑in results.
4. **Resume task**: load `task.json`, call `switch_session`, rebuild UI.

## Where Tests Live

- `src/lib/__tests__/` for store + component tests
- `src/lib/__tests__/fixtures/` for RPC fixtures

## Notes

- We keep tests **VM‑free** by using the mock RPC harness.
- If we ever need true E2E, we can add Playwright later.
