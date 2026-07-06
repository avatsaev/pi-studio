# Task 003 — Thinking tokens, activity log & compaction markers

- **Sprint:** sprint-023-timeline-full
- **Status:** done
- **Estimated size:** M
- **Depends on:** task-001

## Goal
Build the thinking token display (expandable "Thinking…" card), activity log pills (file
writes, git operations, terminal commands), and compaction markers (summarized turn ranges).

## Scope references
- `clean-room-scope/features/timeline-rendering.md` § thinking, § activity log, § compaction

## What to build
- **Thinking card**: when agent emits thinking tokens, show a collapsed "Thinking…" card with
  elapsed timer. On expand, show the thinking text (mono, dimmed). Auto-collapse when thinking
  ends and assistant text begins. Shimmer animation while active.
- **Activity log pills**: between turns, show compact pills for file operations ("+3 files edited"),
  git operations ("committed abc123"), terminal commands ("ran npm test"). Click → expand to
  show individual items. Items link to relevant tabs (file → preview, terminal → terminal tab).
- **Compaction markers**: when the timeline is compacted (old turns summarized), show a
  "Conversation compacted — N turns summarized" marker. Click → show summary text. Option to
  load full history (triggers pagination fetch).
- **Turn grouping footer**: at the end of each assistant turn, show elapsed time + token count
  (from usage data). Reuse `buildTurnFooter()` from sprint-015.
- **Streaming thinking indicator**: while thinking, the assistant row shows a subtle shimmer
  instead of the cursor (thinking and responding are different states).

## Acceptance criteria
- [ ] Thinking card shows with timer while active; collapses when response starts; expandable.
- [ ] Activity pills summarize file/git/terminal activity; expandable; link to relevant tabs.
- [ ] Compaction marker renders; click shows summary; "Load full" triggers pagination.
- [ ] Turn footer shows time + tokens from usage data.

## Test / verification plan
- Thinking: emit thinking tokens → verify card appears with timer → emit text → verify collapse.
- Activity: emit 5 file-write events → verify "5 files edited" pill.
- Compaction: render with compacted flag → verify marker; click load → verify fetch triggered.
