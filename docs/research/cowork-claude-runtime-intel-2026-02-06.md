# Cowork / Claude Runtime Intel (2026-02-06)

Source: direct runtime probing reported by Claude in-session (user-provided transcript)
Confidence: medium-high for observed facts, medium for interpretation
Purpose: architecture reference for piwork runtime/sandbox planning

> This is **field intel**, not an official spec. Treat as directional evidence and re-verify before copying design details 1:1.

## 1) High-level shape

Reported setup is a long-lived Linux VM (Ubuntu arm64) with task-scoped execution environments created per session.

Key pattern:

- VM persists
- each task/session gets a fresh Linux user + home on `/sessions`
- execution enters via `bwrap` with namespace + privilege restrictions
- network egress is proxy-gated (no direct outbound route from task namespace)

## 2) Process / sandbox entrypoint

Reported process tree:

- PID 1: `bwrap`
- child shell process
- sidecar `socat` bridges for proxy sockets
- Claude CLI process

Reported `bwrap` traits:

- `--unshare-pid`
- `--unshare-net`
- `--die-with-parent`
- `--new-session`
- root bind setup + selected overlays/binds
- explicit proxy env variables

## 3) User/session isolation

Reported behavior:

- each task gets a new Linux user (incrementing UIDs)
- per-session home dirs under `/sessions/<name>`
- old session dirs persist but are permission-isolated (ownership remapped to `nobody`)

Implication:

- persistence without cross-session readability
- isolation is primarily enforced by Unix ownership + sandboxing

## 4) Filesystem model

Reported mounts include:

- VM-local OS disk
- separate writable sessions disk
- host-exposed paths via bind/fuse mounts with mixed RO/RW policy

Reported policy examples:

- uploads + skills mounts read-only
- selected user folder read-write
- writes to protected system paths denied by permissions

## 5) Network model

Reported network behavior:

- task runtime in isolated net namespace
- loopback only; no direct route to internet
- proxies required via local TCP endpoints bridged to host Unix sockets
- direct egress attempts fail (`Network is unreachable`)

## 6) Privilege hardening

Reported from `/proc/self/status`:

- no capabilities (all sets zero)
- `NoNewPrivs: 1`
- seccomp enabled with multiple filters

## 7) Task switch semantics

Reported behavior:

- VM reused across tasks
- new user/sandbox namespace per task
- previous session data remains on disk but locked away via ownership/permissions

## 8) Relevance for piwork

Potentially reusable principles:

1. Keep VM persistent for low-latency switching
2. Make task scope enforceable (not just `cwd` convention)
3. Separate persistence disk/area from base image
4. Use per-task user identities for ownership boundaries
5. Add sandbox layer to narrow filesystem/network blast radius

## 9) What we should not copy blindly

- exact bind/mount sequence and options
- assumptions about 9p ownership semantics under our stack
- seccomp profile details without threat-model fit
- network isolation complexity before MVP needs it

## 10) Follow-up verification checklist (for us)

Before implementation decisions, confirm in our runtime:

- ownership behavior for mounted workspace paths under non-root users
- path escape handling (`..`, symlinks, special files)
- task-to-task read/write isolation tests
- prompt/switch latency impact after scope enforcement

## 11) Current recommendation alignment

For MVP, this intel supports **Path I-lite**:

- enforce strict workspace scope checks now
- keep no-restart task switching
- defer full hostile-code hardening stack (bwrap/seccomp/proxy) to later tranche

## 12) Prompt-context pattern (user-supplied Cowork prompt reconstruction)

Additional field intel from a user-provided reconstruction of Cowork's system prompt suggests they explicitly pass **filesystem role hints** to the model each session, including:

- scratch/runtime path (internal, user-invisible)
- workspace path (user-visible folder)
- uploads path
- clear instruction on where deliverables should go

Why this matters for piwork:

- model responses about "where files are" can drift to stale path memory if cwd changed earlier in the task
- explicit per-turn/per-session FS context likely reduces this class of error

Practical inspiration for piwork (MVP-safe):

1. Provide stable path-role hints in runtime context:
   - working folder mount (`/mnt/workdir`)
   - scratchpad outputs (`/mnt/taskstate/<task>/outputs`)
   - uploads (`/mnt/taskstate/<task>/uploads`, read-only)
2. Add a behavior rule for path-sensitive replies:
   - when user asks copy/move/location questions, verify current cwd (`pwd`) before claiming location
3. Keep this narrowly scoped to filesystem correctness (do not mirror Cowork's broader product-specific prompt policy yet)

Note: this section is based on user reconstruction, not official Anthropic documentation.
