# Runtime v2 `taskd` Sync Spec (Path S)

Status: draft (Path S selected at Gate G1)
Audience: host runtime service + guest `taskd` implementation
Related: `docs/runtime-v2-taskd-plan.md`, `docs/runtime-v2-taskd-rpc-spec.md`

## 1) Scope

This document defines Path S workspace sync protocol phases:

1. **Phase 3S-a (dry-run):** manifest + conflict reporting only (no file writes)
2. **Phase 3S-b (apply):** host↔guest file apply after dry-run stability

P0 task lifecycle RPCs remain normative in `runtime-v2-taskd-rpc-spec.md`.

## 2) Preconditions

- `runtime_v2_taskd` must be enabled
- `runtime_v2_sync` gates sync behavior
- Host remains authoritative for per-task workspace root policy

Canonical task session remains `/sessions/<taskId>/session.json`.
Workspace mirror target in guest remains `/sessions/<taskId>/work`.

## 3) Transport + envelope

Same JSONL transport/envelope as P0 taskd RPC:

- request: `{ id, type, payload }`
- success: `{ id, ok: true, result }`
- error: `{ id, ok: false, error }`

Sync commands in this spec:

- `sync_manifest`
- `sync_read`
- `sync_apply`

## 4) Sync phases and command availability

### 4.1 Dry-run mode (first implementation target)

- `sync_manifest`: implemented
- `sync_read`: optional/minimal (may be metadata-only)
- `sync_apply`: must reject with `SYNC_APPLY_DISABLED`

### 4.2 Apply mode (after dry-run proves stable)

- `sync_manifest`: implemented
- `sync_read`: implemented for payload transfer as needed
- `sync_apply`: enabled behind feature gate

## 5) Command catalog

## 5.1 `sync_manifest`

Purpose: produce a deterministic operation/conflict plan for one sync unit.

Payload:

```json
{
    "taskId": "task_abc123",
    "direction": "host_to_guest",
    "reason": "before_prompt",
    "hostRevision": "h_000012",
    "guestRevision": "g_000031"
}
```

`direction` values:

- `host_to_guest`
- `guest_to_host`

`reason` values:

- `before_prompt`
- `after_turn`
- `switch_to`
- `switch_away`

Result:

```json
{
    "taskId": "task_abc123",
    "direction": "host_to_guest",
    "dryRun": true,
    "manifestId": "mf_01J...",
    "ops": [
        {
            "op": "write",
            "path": "src/main.ts",
            "size": 1842,
            "sha256": "..."
        }
    ],
    "conflicts": [
        {
            "path": "README.md",
            "hostSha256": "...",
            "guestSha256": "...",
            "reason": "content_diverged"
        }
    ],
    "stats": {
        "files": 12,
        "bytes": 48123
    }
}
```

Dry-run guarantee: no writes performed on either side.

## 5.2 `sync_read`

Purpose: retrieve file payloads for a previously computed manifest.

Payload:

```json
{
    "taskId": "task_abc123",
    "manifestId": "mf_01J...",
    "paths": ["src/main.ts"]
}
```

Result (shape):

```json
{
    "taskId": "task_abc123",
    "manifestId": "mf_01J...",
    "files": [
        {
            "path": "src/main.ts",
            "encoding": "base64",
            "sha256": "...",
            "content": "..."
        }
    ]
}
```

In dry-run mode, implementations may return metadata-only file stubs.

## 5.3 `sync_apply`

Purpose: apply a finalized manifest.

Payload:

```json
{
    "taskId": "task_abc123",
    "manifestId": "mf_01J...",
    "direction": "host_to_guest"
}
```

Result:

```json
{
    "taskId": "task_abc123",
    "manifestId": "mf_01J...",
    "applied": true,
    "stats": {
        "writes": 8,
        "deletes": 1,
        "conflicts": 0
    }
}
```

If apply is disabled, return:

- `SYNC_APPLY_DISABLED` (`retryable: false`)

## 6) Conflict + policy semantics

First-pass conflict policy:

- detect file-level divergence
- preserve both versions (suffix strategy)
- emit `SYNC_CONFLICT`
- keep task usable

Mandatory policy checks (before apply writes):

- reject absolute paths and traversal (`..`)
- reject symlink follow
- reject special files (device/socket/fifo/hardlink cases)

Policy violation behavior:

- emit `SYNC_POLICY_VIOLATION`
- abort affected sync unit
- keep task alive/recoverable

## 7) Error codes (sync)

- `SYNC_APPLY_DISABLED`
- `SYNC_CONFLICT`
- `SYNC_POLICY_VIOLATION`
- `SYNC_TOO_LARGE`
- `SYNC_TIMEOUT`
- `INVALID_REQUEST`
- `INTERNAL_ERROR`

## 8) Events (sync)

Recommended event set:

- `sync_started(taskId, direction, reason, manifestId)`
- `sync_conflict(taskId, manifestId, count)`
- `sync_complete(taskId, manifestId, stats)`
- `sync_error(taskId, code, message)`

Hosts must ignore unknown events for forward compatibility.

## 9) Sequencing (target flow)

1. `before_prompt`: host -> `sync_manifest(host_to_guest)` (+ apply later)
2. prompt turn runs
3. `after_turn`: host -> `sync_manifest(guest_to_host)` (+ apply later)
4. switch away: best-effort `guest_to_host`
5. switch to: refresh `host_to_guest`

## 10) Implementation rollout

1. Land dry-run plumbing + conflict telemetry
2. Validate with harness loops and large-workspace tests
3. Enable apply behind explicit gate
4. Add budgets/hash verification/audit trail hardening
