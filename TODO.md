# TODO

## Now

- [x] **Reactive model/bootstrap sequencing (P0 stability)** — move runtime model setup from timeout-driven polling to explicit task readiness states.
  - Add a per-task child-command queue in `taskd` so bootstrap `set_model` and first `get_available_models` are serialized.
  - Expose bootstrap readiness/error in `runtime_get_state` and gate UI model-fetch requests on that signal.
  - Keep timeout values only as fallback safety rails, not primary control flow.
- [ ] **Proper auth MVP (P0)** — API-key-first onboarding + explicit apply/restart flow for auth changes; keep "Import from pi" as convenience. Defer OAuth `/login` until runtime/session lifecycle is specified.
- [ ] **Add file import UX (P0)** — support importing local files into task `uploads`, then show/preview them in Scratchpad immediately while keeping uploads read-only after import.
- [ ] **Untangle auth state from runtime artifacts** — keep auth storage purpose clear; avoid mixing credentials with unrelated pi/session artifacts.
- [x] **Pause OAuth `/login` entry points (for now)** — keep auth API-key-first while OAuth lifecycle is still underspecified in RPC/session flow.
- [ ] **Inject minimal FS runtime hint into prompts** — include working-folder host path + `/mnt/workdir` alias + scratchpad path, and refresh when folder is bound later (not just at startup).

## Next

- [ ] **Model scope toggle in Settings** — add `Preferred only` (default shortlist we define) vs `All available` filtering for model picker results.
- [ ] **Markdown rendering** — render agent responses (bold, lists, code blocks). Biggest UX gap.
- [ ] **Tool call display** — collapsible "Created a file ›", "Ran command ›" in message stream.
- [ ] **Interruptible composer (steering + follow-ups)** — deferred spec captured in `docs/research/followup-steering-spec.md` (`Enter` while running = steering, `Option+Enter` = queue follow-up, `Option+Up` = recall queued draft, `Esc`/Stop button = interrupt). Revisit after Markdown + tool-call display stabilize.
- [ ] **Context panel usefulness (enrichment)** — panel exists; improve it to surface active connectors/tools and task-referenced files instead of mostly static copy.

## Later

- [ ] **Auth hardening follow-up** — provider-by-provider `/login` reliability through VM NAT, edge-case diagnostics, and clearer failure UX after proper auth MVP ships.
- [ ] **macOS distribution pilot (post-auth)** — once proper auth MVP is stable, publish a downloadable macOS build so external users can try Piwork without local dev setup.
  - Revisit trigger: proper auth MVP done + runtime startup/install path is reliable for fresh machines.
  - Scope: macOS first; Linux/Windows remain later.
- [ ] **Multi-task runtime behavior** — define expected behavior for switching between active tasks without losing running session state (foreground/background semantics, status visibility, resume behavior).
- [ ] **Runtime download** — first-run pack download for non-dev users.
- [ ] **Bundle pi** — include pi in runtime pack instead of copying from global npm.
- [ ] **Onboarding** — first-run experience that doesn't require `mise run runtime-build`.
- [ ] **Settings cleanup** — audit settings surface and remove dead/low-value controls.
- [ ] **Doc cleanup** — consolidate stale docs, kill anything that doesn't match reality.
- [ ] **Code cleanup** — deep pass, remove slop, consistent patterns.
- [ ] **Task title editing** — editable at top of conversation.
- [ ] **Progress indicators** — checkmarks/status hints in right panel for task progress.
- [ ] **Profile chip** — bottom-left identity/plan/status chip.
- [ ] **Empty state polish** — shuffleable task categories + "See more ideas" + richer task tiles like Cowork.
- [ ] **Progress model v2 (non-P0)** — experiment with Cowork-style step/milestone summaries inferred from task/tool activity, with clear confidence/limitations.
- [ ] Connectors (Calendar, Slack, Google Drive, Notion).
- [ ] Clipboard + attachments (images/files with MIME-aware previews).
- [ ] Multi-folder tasks.
- [ ] Cross-platform (Linux/Windows).
- [ ] MITM network proxy.
- [ ] Canvas/rich artifact viewer.
- [ ] qcow2 rootfs (lower RAM).
- [ ] Gate G2 — Gondolin vs deeper sandbox hardening (research only).
