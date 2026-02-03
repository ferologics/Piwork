# Auth Flow (Draft)

## Goal

Let users authenticate once and reuse provider credentials across tasks. Support both **subscription OAuth** (pi `/login`) and **API keys**.

## Principles

- Store credentials on the **host**, not inside the VM.
- Sync credentials into the VM at task start.
- Support **multiple profiles** (personal / work).

## Storage

- Host stores `auth.json` per profile.
- VM reads credentials from a mounted config volume (e.g., `/home/pui/.pi/agent/auth.json`).
- `auth.json` format matches pi’s standard file.
- **No auth files are committed** (secrets remain local).

## Onboarding Flow (v1)

**Phase 1 (dev bootstrap):**

1. **Use host pi credentials directly**: `~/.pi/agent/auth.json`
2. Mount into VM at task start
3. No UI flow yet

**Phase 2 (full login UI):**

1. **Choose provider** (Claude, OpenAI, Gemini, etc.)
2. Pick **Login method**:
   - **Subscription login** (OAuth via pi `/login`)
   - **API key** (manual entry)
3. Save credentials to host profile
4. Show active provider in UI (profile chip + model selector)

## Subscription Login (OAuth)

Use pi’s built‑in `/login` flow to avoid custom OAuth plumbing.

**Option A (preferred):** run a **login helper** process that invokes pi `/login` and streams prompts to the UI. When complete, copy the resulting `auth.json` into the host profile.

**Option B:** expose a **device‑code** flow (if supported), so the UI can show a URL + code while pi waits.

## API Key Flow

- User pastes key into UI.
- Host writes entry to `auth.json`.
- Optional: validate key by listing models.

## Profiles

- Default profile created at first login.
- User can add/switch profiles in Settings.
- Each profile has its own `auth.json` and model defaults.

## Open Questions

- Best way to run pi `/login` in a UI app (helper process vs in‑VM)?
- Do we allow multiple providers per profile or enforce one “active” provider?
- Do we support token refresh on host, or let pi handle refresh inside the VM?
