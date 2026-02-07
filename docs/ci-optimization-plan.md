# CI Optimization + Gate Alignment Plan

## Why this exists

We currently have **three different gate layers** with partially overlapping logic:

1. **GitHub Actions** path filtering (`dorny/paths-filter` in `.github/workflows/ci.yml`)
2. **Local git hooks** (`pre-commit`, `pre-push`) + custom regression skip script
3. **mise tasks** (single commands, currently no path-aware skip semantics)

This works, but feels inconsistent/magical and is hard to reason about.

## Current state (with evidence)

### 1) Runtime pack caching is working

- Run `21780024908` (`check-full`):
  - `Restore runtime pack cache` → cache hit
  - `run-regressions.sh` logged: `cache hit ... skipping rebuild`
- Run `21780738864` (`check-full`):
  - runtime pack key changed (`hashFiles(...)` changed) → expected miss
  - cache saved at end under new key

Conclusion: runtime-pack cache behavior is correct; misses are key invalidation, not breakage.

### 2) Fast check still runs on docs-only changes

- Run `21781078919` changed only `TODO.md`
- `check-full` correctly skipped (`integration=false`)
- `check (fast)` still ran, including setup steps and cache restores

Conclusion: this is expected with current workflow (job always runs; only parts inside are conditionally reduced).

### 3) Rust cache sharing between jobs is suboptimal

`Swatinem/rust-cache` currently uses job-id in key, so `check` and `check-full` do not share the same cache key by default.

### 4) sccache in CI is mostly per-run cold

`sccache --show-stats` confirms usage, but on hosted runners it uses local disk only unless explicitly persisted (or remote backend configured), so cross-run hit rate is usually low.

## Pain points to fix

1. **Path-detection duplication**
   - CI uses glob filters in workflow
   - local `should-run-regressions.sh` uses a separate regex list
2. **Unclear responsibility boundaries**
   - what is enforced locally vs CI is not obvious
3. **Docs-only pushes still pay unnecessary setup cost**
4. **Cache policy is mixed** (`rust-cache` + `sccache`) without a clear strategy

## Target model (single mental model)

### Principle A — One source of truth for path groups

Create a shared filter file (example: `.github/path-filters.yml`) containing groups like:

- `docs_only`
- `frontend`
- `rust`
- `integration`
- `ci_config`

Use this same definition everywhere (CI + local scripts).

### Principle B — CI decides enforcement, local hooks optimize feedback

- CI is authoritative for required gates.
- Local hooks mirror CI intent where practical, but prioritize developer latency.

### Principle C — Skip at job boundaries when safe

For docs-only changes, avoid expensive setup by skipping heavy jobs/steps early.

## Proposed rollout

### Phase 1 — Alignment (no behavioral surprises)

1. Move CI path filters into a dedicated file (`.github/path-filters.yml`).
2. Replace local regression regex with a script that evaluates the same filter file.
3. Add a short `job summary` in CI showing filter outputs (`rust`, `integration`, etc.) for transparency.

### Phase 2 — Docs-only optimization

1. Add `docs_only` and `code_any` (or equivalent) outputs.
2. Skip heavy `check` job work when only docs changed.
3. Keep workflow-level trigger broad (avoid required-check edge cases from `paths-ignore`).

### Phase 3 — Rust cache policy cleanup

1. Share rust-cache between `check` and `check-full` (remove job-id key partitioning).
2. Skip Rust setup/cache restore entirely when `rust=false`.
3. Keep `sccache --show-stats` for observability.

### Phase 4 — Optional sccache persistence experiment

A/B test:

- A: keep current setup (rust-cache only across runs)
- B: add `actions/cache` for `~/Library/Caches/Mozilla.sccache`

Keep only if total wall-clock improves (including cache transfer overhead).

## Open decisions

1. **Do we want docs-only pushes to run any fast checks at all?**
   - Option A: no-op success job
   - Option B: lightweight docs validation only
2. **Should local pre-commit become path-aware, or stay strict (`mise run check`)**?
3. **Do we optimize for minimal complexity or maximal CI speed?**

## Success criteria

- Path-group logic defined once, reused everywhere
- No unexplained run/skip behavior
- Docs-only changes do not pay Rust/setup costs
- Runtime-pack cache hit/miss behavior remains predictable and observable
- CI logs make cache/use/skip reasons explicit
