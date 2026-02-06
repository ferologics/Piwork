# Auth Flow (MVP Baseline)

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
  - auth status for default profile
  - `Import from pi` (`~/.pi/agent/auth.json` → app auth store)
  - opening the auth file path
- Runtime always reads mounted default auth first, then baked auth fallback.
- Test harness auth primitives:
  - `test-auth-list`
  - `test-auth-set-key <provider> <key>`
  - `test-auth-delete <provider>`
  - `test-auth-import-pi`
  - `test-send-login`

## `/login` flow

- UI can send `/login` through the active runtime session.
- Login URLs detected in stream/extension messages are surfaced with Open/Copy actions.
- Open question remains: reliability through VM NAT for all providers.

## Success criteria

- `runtime_get_state` reports an active model when auth is valid.
- `pi_get_available_models` returns at least one model.
- UI picker reflects runtime-reported provider/model.

## Open questions

- Should post-MVP bring back named profiles, or keep default-only permanently?
- Best UX for provider-specific auth troubleshooting when `/login` is unavailable.
