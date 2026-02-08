# Auth Flow (MVP Baseline)

Status: active
Category: canonical
Owner: product/runtime
Last reviewed: 2026-02-08

## Goal

Let users authenticate once and reuse provider credentials across tasks.

## Principles

- Store credentials on the **host**, not inside the VM image by default.
- Mount host auth state into the VM on boot.
- For MVP, use a single auth location: `app_data/auth/default/auth.json`.

## Storage

- Host auth file: `app_data/auth/default/auth.json`
- VM mount root: `/mnt/authstate`
- Runtime mount path used by pi: `/mnt/authstate/default`
- Runtime can still bake credentials into the VM image at build time (`/opt/pi-agent/auth.json`) as fallback.
- `auth.json` format matches pi’s standard file.
- **No auth files are committed** (secrets remain local).

## Current implementation (MVP)

- Settings modal supports:
  - provider API key entry/edit (writes to app auth store)
  - provider removal
  - auth status for default profile
  - `Import from pi` (`~/.pi/agent/auth.json` → app auth store) as optional convenience
  - opening the auth file path
  - explicit `Apply auth changes` action (runtime restart to pick up updated credentials)
- Runtime always reads mounted default auth first, then baked auth fallback.
- Test harness auth primitives:
  - `test-auth-list`
  - `test-auth-set-key <provider> <key>`
  - `test-auth-delete <provider>`
  - `test-auth-import-pi`

## OAuth `/login` (deferred)

- OAuth `/login` is intentionally deferred in Piwork's RPC lane until runtime/session lifecycle behavior is specified end-to-end.
- Current UX and implementation are API-key-first.

## Success criteria

- `runtime_get_state` reports an active model when auth is valid.
- `pi_get_available_models` returns at least one model.
- UI picker reflects runtime-reported provider/model.

## Open questions

- Should post-MVP bring back named profiles, or keep default-only permanently?
- Best UX for provider-specific auth troubleshooting when `/login` is unavailable.
