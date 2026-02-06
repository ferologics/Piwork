# UI Roadmap

Based on Cowork observation + our needs.

> **Status:** directional product doc. The actionable, prioritized execution backlog lives in `../TODO.md`.
> **Sync rule:** when adding/changing roadmap items here, mirror the concrete next actions in `TODO.md`.
> **Last synced:** 2026-02-06.

## Sync with TODO (current execution track)

- **Right panel IA** (Working folder + Scratchpad split, collapsible cards, empty states, quick open-in-Finder) → `TODO.md` / Next
- **Scratchpad continuity** (files remain visible after setting/changing working folder) → `TODO.md` / Next
- **Artifact explorer parity** (same preview/list behavior for working-folder + no-folder tasks) → `TODO.md` / Next
- **Context usefulness** (real connectors + referenced files, not static placeholder copy) → `TODO.md` / Next
- **Progress model improvements** (Cowork-style step/milestone summaries) are explicitly **non-P0** → `TODO.md` / Later: Polish
- **Multi-task runtime switching semantics** (switch without losing running state) → `TODO.md` / Later: Production

## P0: Base Workflows Must Work

Baseline status snapshot:

- [x] **Task resume** - select task, restore conversation + task session
- [x] **Session isolation** - per-task process/session model (taskd)
- [x] **Working folder mount** - host folder mounted into VM via 9p
- [ ] **Show created files clearly** - baseline exists, but right-panel IA/parity polish is still pending (tracked in `TODO.md`)

## P1: Core UX Polish

Make it feel like a real app:

- [ ] **Task title** - editable at top of conversation
- [ ] **Collapsible actions** - "Created a file >", "Searched the web >"
- [ ] **Artifact cards** - file preview with "Open in..." button
- [ ] **Progress indicators** - checkmarks in right panel
- [ ] **Profile chip** - bottom left, show user + plan/status
- [ ] **Auth/settings** - decide MVP scope (currently untested)

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

- [ ] **Login/auth flow** - test OAuth + API key entry
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
