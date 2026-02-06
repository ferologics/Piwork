# Path I-lite Negative Harness Suite

Purpose: codify I2 checks as a repeatable harness flow for traversal/symlink/cross-task escape attempts.

## Run

```bash
./scripts/harness/path-i-lite-negative.sh
```

Optional screenshot name:

```bash
./scripts/harness/path-i-lite-negative.sh path-i-lite-negative-suite
```

## What it validates

1. **Traversal blocked**
   - `preview_read` from task B using `../task-a/secret-a.txt` returns an error.
2. **Symlink escape blocked**
   - `preview_read` from task B using a symlink path returns an error.
3. **In-scope read still works**
   - `preview_read` from task B for its own file succeeds.
4. **Guest scope policy enforced**
   - direct taskd `create_or_open_task` request with `workingFolderRelative: "../escape"` returns `WORKSPACE_POLICY_VIOLATION` in logs.

## Evidence captured

The script captures the required runtime evidence tuple:

- `mise run test-dump-state`
- `mise run test-screenshot <name>`
- supporting lines in `tmp/dev/piwork.log`

It prints artifact paths at the end.

## Notes

- The script starts/stops Piwork automatically.
- It uses existing primitive harness commands (`test-start`, `test-create-task`, `test-set-task`, `test-dump-state`, `test-screenshot`, `test-stop`).
- Workspace/task fixtures are created under `tmp/path-i-lite/`.
