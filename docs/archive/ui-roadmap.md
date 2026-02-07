# UI Roadmap (archive)

Status: archived
Superseded by: `../product-direction.md`, `../../TODO.md`
Closed: 2026-02-07
Archive note: directional roadmap retained for historical context; active direction now lives in `../product-direction.md`.

Based on Cowork observation + our needs.

> **Status:** directional product doc. The actionable, prioritized execution backlog lives in `../TODO.md`.
> **Sync rule:** when adding/changing roadmap items here, mirror the concrete next actions in `TODO.md`.
> **Last synced:** 2026-02-07.

## Sync with TODO (current execution track)

- **P0 cleanup closeout** (remaining runtime naming cleanup, slop/docs sweep, script hygiene, dev watch scope, CI gate burn-in) → `TODO.md` / Now: Foundation cleanup
- **File workflow P0** (imports into `uploads` + immediate Scratchpad visibility + FS runtime hints in prompts) → `TODO.md` / Now: Foundation cleanup
- **Auth direction** (proper auth MVP: OAuth `/login` + API key entry; "Import from pi" as convenience) → `TODO.md` / Now: Foundation cleanup
- **Right panel IA + artifact contract** (Working folder + Scratchpad continuity/parity) → done in `TODO.md`
- **Model picker realism + availability UX + scope controls** → `TODO.md` / Next: Make it usable
- **Context panel** exists already; roadmap item is now enrichment quality, not a net-new panel → `TODO.md` / Next: Make it usable
- **Progress model improvements** (Cowork-style step/milestone summaries) remain explicitly **non-P0** → `TODO.md` / Later: Polish
- **Multi-task runtime switching semantics** (switch without losing running state) → `TODO.md` / Later: Production

## P0: Base Workflows Must Work

Baseline status snapshot:

- [x] **Task resume** - select task, restore conversation + task session
- [x] **Session isolation** - per-task process/session model (taskd)
- [x] **Working folder mount** - host folder mounted into VM via 9p
- [x] **Show created files clearly** - right panel now exposes Working folder + Scratchpad with preview flow

## P1: Core UX Polish

Make it feel like a real app:

- [ ] **Task title** - editable at top of conversation
- [ ] **Collapsible actions** - "Created a file >", "Searched the web >"
- [x] **Artifact cards (baseline)** - scratchpad file preview + working-folder open-in-Finder landed; richer canvas views later
- [ ] **Progress indicators** - checkmarks in right panel
- [ ] **Profile chip** - bottom left, show user + plan/status
- [ ] **Auth/settings polish** - after P0 auth MVP lands, streamline status/errors/import path and remove low-value settings noise

## P2: Empty State & Onboarding

- [ ] **Shuffleable task categories** (like Cowork):
  - "Let's knock something off your list" (current)
  - "Pick a task, any task"
  - "Tidy up and get organized"
  - "Plan for what's ahead"
- [ ] **"See more ideas"** button to shuffle
- [ ] **Richer task tiles** with better prompts

### Cowork Task Templates (observed)

**Row 1 (default):**

- Create a file
- Crunch data
- Make a prototype
- Organize files
- Prep for a meeting
- Draft a message

**"Pick a task, any task":**

- Optimize my week
- Submit my expenses
- Find insights in files

**"Tidy up and get organized":**

- Clean up my Downloads folder
- Organize photos by event/date
- Organize my inbox

**"Plan for what's ahead":**

- Prep for my next meeting
- Plan my next vacation
- Prepare for a job interview

## P3: Production Ready

- [ ] **Login/auth hardening** - provider-by-provider OAuth reliability through VM NAT + diagnostics after proper auth MVP lands
- [ ] **Runtime download** - first-run pack download + updates
- [ ] **Settings cleanup** - review what's actually needed
- [ ] **Doc cleanup** - consolidate/remove stale docs
- [ ] **Code cleanup** - remove slop, consistent patterns

## P4: Later

- [ ] **MITM network mode** - proxy for visibility/control
- [ ] **Cross-platform** - Linux/Windows
- [ ] **Plugins/connectors** - web search badge, etc.
- [ ] **Follow-up questions UI** - "How detailed?" options

## Not Copying

- Feedback buttons (copy/thumbs) - not useful for us
- "Customize with plugins" - later if ever

## Research / References

YouTube videos to analyze:

- https://www.youtube.com/watch?v=UAmKyyZ-b9E - "Introducing Cowork: Claude Code for the rest of your work"
- https://www.youtube.com/watch?v=HTu1OGWAn5w - "How to Use Claude Cowork Better Than 99% of People (Full Guide)"

**Tools:**

- `youtube-transcript` skill - fetch transcripts
- https://github.com/steipete/summarize - summarize video content
- `brave-search` skill - find more Cowork demos/tutorials

**Approach**: No MCP, no fancy stuff. Just pi, maybe skills later. Keep it simple.

## Notes

- Right panel: collapsed by default for normies, maybe expanded in dev?
- Current settings is "vibeslopped" - needs audit
