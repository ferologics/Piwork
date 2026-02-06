# Auth Profile Validation Smoke Check

Purpose: verify invalid auth profile handling across harness primitives and UI profile switching flow.

## Run

```bash
./scripts/harness/auth-profile-validation-smoke.sh
```

## What it validates

1. Starts Piwork in `v2_taskd` mode.
2. Calls `mise run test-auth-list "../evil profile"` and expects an `Invalid auth profile` failure.
3. Calls `mise run test-set-auth-profile "../evil profile"` and expects normalization to `default`.
4. Confirms `test-dump-state` reports `auth=default`.
5. Confirms runtime recovers after profile switch through `test-set-auth-profile` applied-state wait.

## Notes

- Script always runs `mise run test-stop` in cleanup.
- This smoke script does not require screenshot capture.
