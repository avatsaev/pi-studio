# Task 006 — Structured generation (daemon-side metadata)

- **Sprint:** sprint-006-agent-sessions-timeline
- **Status:** done
- **Estimated size:** S
- **Depends on:** task-002; task-003 (sprint-005, registry)

## Goal
Implement daemon-side LLM-backed metadata generation (agent titles, commit messages, PR text, branch
names) using a configurable provider fallback order.

## Scope references
- `clean-room-scope/architecture/structured-generation.md` § Tasks, § Provider selection, § Behavior
- `clean-room-scope/architecture/config.md` (`agents.metadataGeneration.providers`)

## What to build
- `generate(task, context)`: candidates = configured `metadataGeneration.providers` (in order) ++
  discovered defaults ++ current selection; for each available candidate, call its top-level
  `structuredGenerate(prompt, schema)`; return first valid result; else a deterministic fallback
  (e.g. truncated prompt as title).
- Tasks: generated agent title (respect `MAX_EXPLICIT_AGENT_TITLE_CHARS`), commit message, PR
  title/body, branch name.
- **Never** create a throwaway `AgentSession` when a top-level provider API suffices.

## Out of scope
- Git/PR/worktree call sites (sprint-008) — this provides the generator they call.

## Acceptance criteria
- [ ] Metadata tasks try `metadataGeneration.providers` in configured order first.
- [ ] A failing/unavailable provider falls through to the next candidate; all-fail → deterministic fallback.
- [ ] No throwaway agent session is created when a top-level API is available.
- [ ] Generated titles never exceed the title character limit.

## Test / verification plan
- Tests: `npx vitest run .../structured-generation.test.ts` — order, fallthrough, deterministic
  fallback, title-length clamp, no-scratch-session.

## Notes
- Exact prompts/schemas and the deterministic fallback per task are TODO(verify).
