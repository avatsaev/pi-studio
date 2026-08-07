# Task 006 — Structured generation (daemon-side metadata) — Summary

- **Sprint:** sprint-006-agent-sessions-timeline
- **Completed:** 2026-06-11
- **Status:** done

## What was implemented
`packages/server/src/agent/structured-generation.ts`:
- `generate(task, { candidates, context })` — tries each `StructuredGenerationProvider` in order;
  skips unavailable or failing ones; returns the first valid result; falls through to
  `deterministicFallback` if all fail. Tasks: `agent_title`, `commit_message`, `pr_title`,
  `pr_body`, `branch_name`.
- `deterministicFallback(task, context)` — prompt-derived fallback: truncated/cleaned prompt text
  for title/message/pr tasks; slug-safe branch names.
- `truncateTitle` — clamps to `MAX_EXPLICIT_AGENT_TITLE_CHARS` (80) with ellipsis.
- `StructuredGenerationProvider` interface (`isAvailable`, `structuredGenerate`) — uses top-level
  provider APIs only; NO `AgentSession.run/startTurn` is ever called.

## Files created / changed
| File | Change |
|------|--------|
| `agent/structured-generation.ts` | created |
| `agent/index.ts` | modified |
| `agent/structured-generation.test.ts` | added — 8 tests |

## Acceptance criteria
- [x] Tasks try `metadataGeneration.providers` in configured order first.
- [x] A failing/unavailable provider falls through to the next candidate.
- [x] No throwaway agent session created (contract is `structuredGenerate`, not `session.run`).
- [x] Generated titles never exceed `MAX_EXPLICIT_AGENT_TITLE_CHARS`.
