# Auth Store Primitives Smoke Check

Purpose: validate auth-store harness primitives (`test-auth-*`) without UI interactions.

## Run

```bash
./scripts/harness/auth-store-primitives-smoke.sh
```

## What it validates

1. Starts Piwork test harness.
2. Writes an API key with `test-auth-set-key` into a temporary profile.
3. Confirms `test-auth-list` returns an `anthropic/api_key` entry.
4. Deletes the provider with `test-auth-delete` and verifies removal via `test-auth-list`.
5. Optionally imports `~/.pi/agent/auth.json` with `test-auth-import-pi` when available.
6. Captures `test-dump-state` and exits.

## Notes

- Uses a temporary profile and removes it on exit.
- Always runs `mise run test-stop` in cleanup.
- Test-server request logging redacts sensitive fields (`key`, `token`, `password`, `secret`).
