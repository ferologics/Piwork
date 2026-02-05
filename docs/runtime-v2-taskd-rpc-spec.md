# Runtime v2 `taskd` RPC Spec (P0 Normative)

Status: draft (P0 normative)\
Audience: host runtime service + guest `taskd` implementation\
Related: `docs/runtime-v2-taskd-plan.md`

## 1) Scope

This document defines the **normative** wire contract for early rollout (`runtime_v2_taskd`, sync off):

- task lifecycle operations
- prompt routing
- core events and errors

Everything else (sync protocol details, capability negotiation, timeout tuning) is implementation guidance and may evolve later.

## 2) Transport and framing

- Transport: newline-delimited JSON (JSONL) over existing TCP RPC channel
- Encoding: UTF-8 JSON, one object per line
- Ordering: in-order delivery per connection
- Recovery: after reconnect, host must call `get_state` before resuming orchestration

## 3) Envelope formats

### 3.1 Request

```json
{
    "id": "req_01J...",
    "type": "switch_task",
    "payload": {
        "taskId": "task_abc123"
    }
}
```

### 3.2 Success response

```json
{
    "id": "req_01J...",
    "ok": true,
    "result": {
        "status": "switching",
        "taskId": "task_abc123"
    }
}
```

### 3.3 Error response

```json
{
    "id": "req_01J...",
    "ok": false,
    "error": {
        "code": "TASK_NOT_READY",
        "message": "task is not active",
        "retryable": true,
        "details": {}
    }
}
```

### 3.4 Event message

```json
{
    "type": "event",
    "event": "task_ready",
    "timestamp": "2026-02-05T23:00:00.000Z",
    "taskId": "task_abc123",
    "payload": {}
}
```

## 4) Idempotency rules (P0)

- `id` is required on all requests.
- Duplicate request `id` with same payload must not produce duplicate side effects.
- Duplicate request `id` with different payload returns `INVALID_REQUEST`.

Applies to at least:

- `create_or_open_task`
- `switch_task`
- `stop_task`

## 5) Command catalog (P0)

## 5.1 `create_or_open_task`

Payload:

```json
{
    "taskId": "task_abc123",
    "provider": "anthropic",
    "model": "claude-opus-4-6",
    "thinkingLevel": "high",
    "workingFolder": "/sessions/task_abc123/work"
}
```

Result:

```json
{
    "taskId": "task_abc123",
    "state": "ready",
    "mode": "created"
}
```

`mode` values:

- `created` (from `missing`)
- `resumed` (from `stopped`)
- `recovered` (from `errored`)

## 5.2 `switch_task`

Payload:

```json
{ "taskId": "task_abc123" }
```

Immediate result:

```json
{ "status": "switching", "taskId": "task_abc123" }
```

Completion is signaled by `task_ready` or `task_error` event.

## 5.3 `prompt`

Payload:

```json
{ "message": "hello", "promptId": "pr_123" }
```

Result:

```json
{ "accepted": true, "taskId": "task_abc123", "promptId": "pr_123" }
```

Completion is signaled by `agent_end` or `task_error`.

## 5.4 `get_state`

Payload: `{}`

Result shape:

```json
{
    "activeTaskId": "task_abc123",
    "tasks": [
        {
            "taskId": "task_abc123",
            "state": "active",
            "sessionFile": "/sessions/task_abc123/session.json",
            "workDir": "/sessions/task_abc123/work"
        }
    ]
}
```

## 5.5 `stop_task`

Payload:

```json
{ "taskId": "task_abc123" }
```

Result:

```json
{ "taskId": "task_abc123", "state": "stopped" }
```

## 6) Event catalog (P0)

Required:

- `task_switch_started`
- `task_ready`
- `task_error`
- `task_stopped`
- `agent_output`
- `agent_end`

Host behavior:

- Ignore unknown event types (forward-compatible)

## 7) Ordering guarantees (P0)

For one switch attempt:

1. `switch_task` success response (`status: "switching"`)
2. `task_switch_started`
3. terminal event:
   - `task_ready`, or
   - `task_error`

For one prompt:

1. `prompt` response (accepted/rejected)
2. zero or more `agent_output`
3. terminal event:
   - `agent_end`, or
   - `task_error`

## 8) Error codes (P0)

- `TASK_NOT_FOUND`
- `TASK_NOT_READY`
- `SWITCH_TIMEOUT`
- `PI_PROCESS_DEAD`
- `INVALID_REQUEST`
- `INTERNAL_ERROR`

Error object fields:

- `code` (string)
- `message` (string)
- `retryable` (boolean)
- `details` (object, optional)

## 9) Crash and recovery semantics

- `taskd` detects task process exit and emits `task_error` with `PI_PROCESS_DEAD`
- Task transitions to `errored`
- Host can recover by calling `create_or_open_task` (`mode: "recovered"`)
- Last in-flight turn may be lost if crash occurred before atomic session flush

## 10) Deferred extensions (non-normative)

Deferred until workspace decision gate and sync path selection.
These items move to a dedicated Path-S spec: `docs/runtime-v2-taskd-sync-spec.md`.

Deferred items:

- `sync_manifest`
- `sync_read`
- `sync_apply`
- sync-specific errors (`SYNC_CONFLICT`, `SYNC_POLICY_VIOLATION`, ...)
- capability negotiation fields (`protocolVersion`, `capabilities`)
- detailed retry/timeout tuning tables

These will be specified once Path M (live mount) vs Path S (sync) is decided.
