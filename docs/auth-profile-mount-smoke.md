# Auth Profile Mount Smoke Check

Purpose: verify that host auth profile state is mounted into VM and selected on boot.

## Run

```bash
./scripts/harness/auth-profile-mount-smoke.sh
```

Optional screenshot name:

```bash
./scripts/harness/auth-profile-mount-smoke.sh auth-profile-mount-smoke
```

## What it validates

1. Writes a temporary sentinel auth entry to `app_data/auth/default/auth.json`.
2. Starts Piwork in `v2_taskd` mode.
3. Confirms in `qemu.log`:
   - `Mounted auth state at /mnt/authstate`
   - `Using mounted auth profile: default`
4. Captures evidence tuple:
   - `test-dump-state`
   - `test-screenshot <name>`
   - `qemu.log` lines
5. Restores previous auth file and stops runtime on exit.

## Artifacts

- screenshot: `tmp/dev/<name>.png`
- VM log: `~/Library/Application Support/com.pi.work/vm/qemu.log`
