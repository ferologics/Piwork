# Auth Profile Switch Smoke Check

Purpose: verify test-harness auth profile switching applies to VM startup and runtime state.

## Run

```bash
./scripts/harness/auth-profile-switch-smoke.sh
```

Optional screenshot name:

```bash
./scripts/harness/auth-profile-switch-smoke.sh auth-profile-switch-smoke
```

## What it validates

Preflight:

- runs `mise run test-check-permissions`

Checks:

1. Creates temporary `default` and `work` host auth profiles.
2. Starts Piwork in `v2_taskd` mode.
3. Calls `mise run test-set-auth-profile work` (UI event + runtime restart).
4. Confirms VM boot log contains `Using mounted auth profile: work`.
5. Confirms `test-dump-state` output includes `auth=work`.
6. Captures screenshot evidence.

## Artifacts

- screenshot: `tmp/dev/<name>.png`
- VM log: `~/Library/Application Support/com.pi.work/vm/qemu.log`
- app log: `tmp/dev/piwork.log`

## Notes

- Script restores previous `default/work` auth files on exit.
- Script always runs `mise run test-stop` in cleanup.
