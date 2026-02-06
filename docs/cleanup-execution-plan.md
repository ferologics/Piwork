# Piwork — Implementation Plan (final)

This is the concrete, sequenced implementation plan to get from the current “mixed prototype” state to a coherent MVP foundation:

- **one explicit host↔taskd protocol lane** (V2 envelope only)
- **truthful model picker** (no fallback lists)
- **default-only auth** (MVP)
- **smaller `MainView`** (de-risk future UX work)
- **harness regressions + slop purge** so the repo stops drifting

Non-goals (explicitly out of scope for this plan): sandbox hardening beyond current policy, connectors, attachments UX, Markdown rendering, tool-call UI polish, onboarding/runtime download.

---

## Global rules for every PR

- Must pass locally: `mise run check` (fast)
- Must pass before merge (pre-push/CI): `mise run check-full`
- Evidence for behavior claims:
  - `mise run test-dump-state`
  - `mise run test-screenshot <name>`
  - relevant log excerpt (`tmp/dev/piwork.log` or QEMU log)
- Prefer harness primitives; if a regression suite script is needed, keep it short and focused (like `path-i-lite-negative.sh`).

---

## PR-0 — Testing sanity gate (highest priority)

### Goal

Stop regressions from slipping through by moving core behavior checks into automated test code (Vitest + Rust), while keeping everyday local checks fast.

### Scope / changes

1. Add a machine-readable debug snapshot command for tests (instead of log-string parsing).
2. Add Vitest regression tests for:
   - folder bind continuity (no conversation/UI reset)
   - reopen existing folder-bound task resolves runtime cwd to `/mnt/workdir...`
   - working-folder panel refresh when folder changes on same task id
   - runtime mismatch badge only when truly mismatched (not transient boot/legacy)
   - tests run against a live app process and assert on structured `state_snapshot` payloads (not log grep)
3. Keep shell harness only as optional smoke/probe while parity is reached; do not treat ad-hoc shell runs as primary quality gate.
4. Add a single regression task (`mise run test-regressions`) and wire a separate full gate (`mise run check-full = check + regressions`).

### Done when

- Reproductions for recent regressions fail before fix and pass after fix in automated tests.
- `mise run check` stays fast for daily use.
- `mise run check-full` blocks merges when liftoff path contracts break.

### Validation

- `mise run check`
- `mise run test-regressions`
- `mise run check-full`

---

## PR-1 — Add V2 bridge commands + migrate UI off legacy host commands (and make models truthful)

### Goal

Host UI stops sending legacy-shaped commands (`get_state`, `get_available_models`, `set_model`, `extension_ui_response` without V2 envelope). Instead, everything host-initiated is V2 `{ id, type, payload }`, but **taskd still supports legacy temporarily** to avoid “big bang” churn.

Also: model picker becomes truthful immediately (no fake fallback lists).

### Scope / changes

#### 1) taskd: add V2 bridge commands (host → taskd → active pi child)

In `runtime/taskd.js` (V2 handler):

- **Extend `runtime_get_state`** result to include what the UI needs (so UI does not need pi `get_state`):
  - per task: `provider`, `model`, `thinkingLevel`, `promptInFlight`
  - keep existing fields (`taskId`, `state`, `currentCwd`, `workingFolderRelative`, etc.)

- **Add `pi_get_available_models`** (V2):
  - ensure there is an active task process (use existing `ensureLegacyActiveTask()` if no active task)
  - `await sendToTask(activeTask, { type: "get_available_models" })`
  - return `result: { models: [...] }`
  - if pi returns an error/empty list, return that truthfully (no fallback models)

- **Add/replace `pi_set_model`** (V2):
  - payload: `{ provider, modelId }`
  - update taskd defaults + active task’s `provider/model`
  - `await sendToTask(activeTask, { type: "set_model", provider, modelId })`
  - return model info in `result` (either from pi response data or echo back `{provider, id:modelId, name:modelId}`)

- **Add V2 `extension_ui_response`**:
  - payload contains exactly what pi expects, including the pi UI request id
  - `await sendToTask(activeTask, { type: "extension_ui_response", ...payload })`

Keep legacy host handling in place for this PR only (delete in PR-2).

#### 2) RuntimeService: expose explicit methods for these commands

In `src/lib/services/runtimeService.ts`:

Add public methods (or equivalent):

- `runtimeGetState(): Promise<{ activeTaskId: string|null; tasks: ... }>`
- `piGetAvailableModels(): Promise<{ models: unknown[] }>`
- `piSetModel(provider: string, modelId: string): Promise<void | result>`
- `sendExtensionUiResponse(payload: Record<string, unknown>): Promise<void>`

Implementation should use existing `sendTaskdCommand(...)` (V2) so all calls are envelope-shaped and response-correlated.

Also update `resolvePendingRpcResponse(...)` call-sites if needed, but don’t remove legacy support yet (that’s PR-2).

#### 3) MainView: remove fallback model lists + switch to the new RuntimeService methods

In `src/lib/components/layout/MainView.svelte`:

- Delete:
  - `fallbackModels`
  - `PREFERRED_MODEL_PATTERNS`
  - preferred filtering logic (until you deliberately reintroduce it later)
- Add UI state for models:
  - `modelsLoading`
  - `modelsError`
  - `availableModels: ModelOption[]` starts empty
  - `selectedModelId` starts empty
- Replace:
  - `requestState()` legacy send → call `runtimeService.runtimeGetState()` and update:
    - `runtimeDebugStore` (update store to accept runtime_get_state result)
    - `selectedModelId` from the active task entry (provider/model) if present
  - `requestAvailableModels()` legacy send → call `runtimeService.piGetAvailableModels()`
  - `handleModelChange()` legacy send → call `runtimeService.piSetModel(...)`
  - `sendUiResponse()` legacy send → call `runtimeService.sendExtensionUiResponse(...)`

UI behavior requirements:

- If `availableModels.length === 0`, show a clear “No models available” state and disable the `<select>`.
- If `pi_get_available_models` errors, show error text and disable picker.

#### 4) runtimeDebugStore update

Update `runtimeDebugStore` (file not shown in snapshot, but it exists) so it can ingest **runtime_get_state** results instead of pi legacy `get_state`.

### Done when

- Frontend codebase has **zero** calls that send legacy host commands:
  - no `runtimeService.send({ type: "get_state" })`
  - no `get_available_models` / `set_model` legacy sends
  - no raw legacy `extension_ui_response` sends
- Model picker renders only real runtime-reported models (or empty/error), never a hardcoded list.

### Validation

- `mise run check`
- Harness smoke:
  - `mise run test-start`
  - `mise run test-create-task "RPC cleanup smoke" <folder>`
  - `mise run test-prompt "hello"`
  - `mise run test-dump-state`
  - `mise run test-screenshot pr1`
  - `mise run test-stop`
- Regression suite:
  - `./scripts/harness/path-i-lite-negative.sh`

---

## PR-2 — Enforce V2-only host protocol + delete legacy host handling + add protocol audit + update RPC docs

### Goal

After this PR: there is **one host protocol lane**. Taskd no longer accepts “legacy-shaped” host requests at all, so ambiguity cannot reappear.

### Scope / changes

#### 1) taskd: remove legacy host request support

In `runtime/taskd.js`:

- Delete:
  - `handleLegacyRequest` and all `handleLegacy*` helpers
  - `sendLegacyResponse`
  - `FALLBACK_MODELS`
  - `isV2Request` heuristic and `hasPayloadField` routing
- Make request parsing strict:
  - require `id: string`
  - require `payload: object` (or at least `payload` present; decide and document)
  - invalid/missing fields → V2 error `{ ok:false, error:{ code:"INVALID_REQUEST", ... } }`

#### 2) RuntimeService: resolve pending responses only for taskd V2 responses

In `src/lib/services/runtimeService.ts`:

- Tighten `resolvePendingRpcResponse(...)`:
  - only treat `{ id, ok: boolean }` as command responses
  - do **not** resolve pending requests based on forwarded pi `{ type:"response", ... }` lines

This prevents accidental collision between host request ids and forwarded pi response ids.

#### 3) Add mechanical enforcement: protocol audit task

Add:

- `scripts/audit/protocol.sh` (or `.mjs`) that fails if:
  - frontend contains legacy sends for `get_state`, `get_available_models`, `set_model`, `extension_ui_response`
  - taskd still contains `handleLegacy` symbols

Wire it into mise:

- add `tasks.audit-protocol`
- add it to `tasks.check` (preferred) or at least document and enforce in CI/dev workflow.

#### 4) Docs: make the RPC spec the single source of truth

Update:

- `docs/runtime-taskd-rpc-spec.md` to describe:
  - V2 envelope shape
  - supported request types (including `pi_get_available_models`, `pi_set_model`, `extension_ui_response`)
  - response shape + error codes
  - which payloads are forwarded pi stream events vs taskd V2 responses

Also update any stale mentions in:

- `AGENTS.md` (if it references legacy behavior)
- `README.md` (only if necessary)

### Done when

- Sending a legacy-shaped host request to taskd yields a clear `INVALID_REQUEST` V2 error.
- The audit task passes and is part of the “normal” check path.

### Validation

- `mise run check`
- Run the same harness smoke + `path-i-lite-negative.sh` as PR-1.

---

## PR-3 — Persist model selection to task metadata (and make task switching restore model intent)

### Goal

Model choice is not ephemeral; switching/reopening tasks restores the intended model (and provider).

### Scope / changes

#### 1) Persist provider + model (recommended)

Add `provider` to task metadata (new optional field):

- Rust: `src-tauri/src/task_store.rs` `TaskMetadata { provider: Option<String>, ... }`
- TS: `src/lib/types/task.ts` `provider?: string | null`
- UI store normalize/upsert should preserve it.

#### 2) Update UI behavior

When user changes model:

- call `runtimeService.piSetModel(provider, modelId)`
- `taskStore.upsert({ ...task, provider, model: modelId, updatedAt: now })`

On task switch:

- initialize picker selection from `activeTask.provider/model` (if present)
- runtimeService already passes model intent during `create_or_open_task` (update `buildCreateOrOpenTaskPayload` to use explicit provider if available; only infer as fallback)

#### 3) Optional: add a harness primitive for model setting

Add a dev test-server command + mise task:

- `{"cmd":"set_model","provider":"...","modelId":"..."}` that triggers the same UI path (so persistence is exercised, not just RPC).

### Done when

- After switching away and back to a task, the picker reflects that task’s saved model.
- Task creation/switch sends the persisted model intent down to taskd.

### Validation

- `mise run check`
- Harness scenario (manual composition of primitives or a small script):
  - start app
  - create task A
  - set model to X
  - create task B
  - switch back to A
  - assert UI model picker is X (screenshot + dump-state)

---

## PR-4 — Auth profile cull (default-only MVP) + harness/docs sync

### Goal

Remove remaining multi-profile plumbing; standardize on `default` everywhere.

### Scope / changes

- Frontend:
  - remove `piwork:auth-profile` storage use
  - remove `test_set_auth_profile` listener + `applyAuthProfileForTest`
  - runtimeService snapshot no longer needs `authProfile` field (or keep constant `"default"` but don’t expose switching)

- Rust:
  - remove `auth_profile` arg from `vm_start`
  - auth store commands no longer accept `profile` params (or they ignore/remove; prefer removal)
  - auth file path is always `app_data/auth/default/auth.json`

- runtime:
  - `runtime/init.sh` stops reading `piwork.auth_profile`; always uses `/mnt/authstate/default` fallback logic + baked auth

- Harness/docs:
  - remove `mise run test-set-auth-profile` and related README references

### Done when

- There is no codepath that switches auth profile or stores a profile name.
- Settings still supports “Import from pi” and shows current auth status.

### Validation

- `mise run check`
- `mise run test-start`
- `mise run test-auth-import-pi`
- `mise run test-prompt "hello"` (or minimal prompt that requires auth if available)
- dump-state + screenshot + stop

---

## PR-5 — Decompose `MainView` (no behavior changes) + slop purge + harness regressions

### Goal

Reduce churn surface and delete dead weight so future features don’t accrete into a single god component.

### Scope / changes

#### 1) Decompose `MainView.svelte` into focused pieces (no behavior changes)

Extract:

- `ModelPicker.svelte`
- `LoginUrlBanner.svelte`
- `PreviewPane.svelte`
- `useExtensionUiQueue.ts`
- `useHarnessListeners.ts` (dev-only)

#### 2) Slop purge (verify before deleting)

Candidates to remove/fix:

- `src/lib/components/ProviderList.svelte` (if unused)
- `src/lib/utils/notice.svelte.ts` (if unused)
- `taskStore.ts` `SESSION_FILE` constant (looks wrong/misleading relative to taskd sessions; either remove or correct usage)

Quarantine lab scripts:

- move `scripts/mitm-*` under `scripts/lab/` (or `docs/research/`) with a short README pointer

#### 3) Add missing harness regressions from TODO

- Working-folder write regression:
  - set folder
  - immediately prompt tool write (or system_bash write through taskd if appropriate)
  - assert host path has file
- Open-folder action regression:
  - add a test-server command that exercises the same Rust `open_path_in_finder` call with the active task working folder
  - capture logs + screenshot as evidence

### Done when

- `MainView.svelte` is materially smaller and mostly orchestrates components/hooks.
- Dead files are removed and nothing references them.
- The two harness regressions exist and are runnable.

### Validation

- `mise run check`
- Run:
  - `./scripts/harness/path-i-lite-negative.sh`
  - new harness regressions (scripts or primitive sequences)

---

## After this plan (explicit next targets)

Once the above is done, the “Make it usable” track is unblocked and much safer to implement:

- Markdown rendering (biggest UX gap)
- Tool call display (collapsible “Created a file”, “Ran command”)
- Context panel usefulness
- Runtime download/onboarding work

If you want, I can convert the above into PR checklists with exact function-level edits per file (still plan-only, no code) to make execution even more mechanical.
