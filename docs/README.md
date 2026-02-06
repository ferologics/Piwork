# Docs Index

This folder contains both **current runtime docs** and **older draft/research notes**.

## Runtime: source of truth (current)

- `runtime-v2-taskd-plan.md` — rollout status, phases, and active execution track.
- `runtime-v2-taskd-rpc-spec.md` — normative v2 taskd RPC contract.
- `runtime-g2-architecture-spike.md` — post-MVP research lane (Path G / deeper hardening).
- `adr/0001-runtime-g2-decision.md` — decision record template.

## Runtime: supporting / contextual

- `pi-integration.md` — host↔VM↔pi integration overview.
- `runtime-pack.md` — VM runtime pack + boot model (current dev behavior + packaging notes).
- `testing-strategy.md` — test approach and harness expectations.
- `path-i-lite-negative-suite.md` — repeatable I2 negative checks (traversal/symlink/cross-task scope).
- `auth-profile-mount-smoke.md` — repeatable auth mount/profile smoke verification.
- `auth-profile-switch-smoke.md` — repeatable auth profile switch + runtime restart verification.

## Runtime: on-hold fallback

- `runtime-v2-taskd-sync-spec.md` — Path S sync protocol draft (not active unless explicitly re-selected).

## Product / policy docs

- `permissions-model.md` — user-visible permissions model.
- `auth-flow.md` — auth behavior.
- `mvp-definition.md` — locked MVP scope decisions (scope/auth/settings/first-run).
- `ui-roadmap.md` — UI roadmap.

## Research notes

- `research/` — Cowork notes, sketches, and field intel.
- `research/cowork-claude-runtime-intel-2026-02-06.md` — captured runtime observations from Claude/Cowork probing.

---

If a doc conflicts with `runtime-v2-taskd-plan.md`, treat the plan doc as authoritative.
