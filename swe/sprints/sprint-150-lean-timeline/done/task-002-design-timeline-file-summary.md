# Task 002 — Design: the agent timeline file (owner review) — Summary

- **Sprint:** sprints/sprint-150-lean-timeline
- **Completed:** 2026-11-25
- **Status:** done

## What was implemented
`swe/architecture/agent-timeline-persistence.md` (about 560 lines): problem and measurements, alternatives, file format, crash behaviour, sequence numbers, open order, operations, memory, paging, durability, failure handling, test plan and five owner decisions.

## Outcome: not adopted (owner decision, 2026-11-25)
After reading the measurements the owner and I agreed the file is not worth it:
- Pi's session file already restores the whole conversation (messages, answers, thinking, tool calls and results, completed compactions); what a restart changes is cosmetic (failed or cancelled compaction rows and mid-stream error rows, the "running" step of a tool call, exact timestamps, the daemon's internal numbering).
- A daemon restart closes every connection and the workbench refetches the whole timeline, so stable numbering across restarts buys almost nothing.
- Paging costs milliseconds at real sizes (the largest real session drains in 26 ms).
- A second copy of the conversation brings drift and new disk failure modes (the design's own "handle guard" exists only to manage them).

What is kept: bounded memory and one row per message. Tasks 003 to 005 of this sprint were replaced by a smaller piece of work with no second copy: merge chunks in memory, evict on archive and delete, remove the dead `record.timeline` writes. The document stays, marked "not adopted", as the evidence.

## Acceptance criteria
- [x] The owner reviewed the document and decided (recorded in the document's Approval section)
