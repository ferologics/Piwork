# Runtime v2 `taskd` Sync Spec (Path S — Deferred)

Status: placeholder (deferred)\
Prerequisite: Gate G1 chooses Path S (sync) in `docs/runtime-v2-taskd-plan.md`

This document will define sync-specific protocol details once Path S is selected:

- `sync_manifest`
- `sync_read`
- `sync_apply`
- revision/checkpoint semantics
- sync-specific error codes
- conflict manifest format
- policy-violation behavior details

Until then, `docs/runtime-v2-taskd-rpc-spec.md` remains the only normative spec for P0 (`runtime_v2_taskd`, sync off).
