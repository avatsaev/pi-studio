# Task 006 — CLI: suppress partial events in `agent watch`/`attach`

- **Sprint:** sprint-058-tool-output-streaming
- **Status:** backlog
- **Type:** feature
- **Area:** packages/cli
- **Priority:** P1
- **Estimated size:** XS
- **Depends on:** task-001

## Goal

`pi-studio agent watch` and `attach` print nothing for `partial: true` stream events, in both plain
and `--json` render modes.

## Context / why

The live subscription in `agent-commands.ts` renders **one line per `agent_stream` event**
(`agent-commands.ts:291-296`): a `tool_call` prints as `[shell running] npm test` via
`formatStreamEvent` (`agent-commands.ts:70-111`). Once the daemon starts broadcasting partials
(tasks 002–004), a 2-minute build would print the **same line ~600 times** — a duplicate every
≤200 ms for the tool's whole lifetime. `--json` mode is equally affected and bypasses
`formatStreamEvent` entirely (`renderJson` at line 294-295), so the guard must sit at the
**subscription site**, before the mode branch — not inside the formatter.

The fetch-based paths (`agent log`, timeline rendering at `agent-commands.ts:266-273`) need no
change: partials never appear in fetched pages (task 004).

Rendering streamed output in the CLI (e.g. an updating line) is **explicitly out of scope** — the
live tail is a web-client affordance; the CLI's job here is only not to degrade.

## Scope references

- `swe/features/tool-output-streaming.md` § Behavior & Algorithms → Client CLI, § Error Handling
  (CLI row)
- `packages/cli/src/agent-commands.ts:70-111` — `formatStreamEvent`
- `packages/cli/src/agent-commands.ts:291-296` — the `onSessionMessage` watch subscription
- Modify: `packages/cli/src/agent-commands.ts`, `packages/cli/src/agent-commands.test.ts`

## What to build

One guard in the watch subscription, before the `opts.json` branch:

```
if (m.event.kind === "tool_call" && m.event.partial) return;
```

Nothing else. `formatStreamEvent` stays partial-unaware (it also renders fetched timeline items,
which never contain partials). Type the check against the updated `AgentStreamEvent` from task 001
rather than a cast.

## Out of scope

- Any richer CLI rendering of streamed output (updating lines, tails).
- `agent log` / fetched-timeline paths — structurally unaffected.
- `formatStreamEvent` changes.

## Acceptance criteria

- [ ] Pushing a `partial: true` `tool_call` frame through the watch loop produces **no** output line
      in plain mode and **no** JSON line in `--json` mode.
- [ ] Non-partial `tool_call`, `assistant_message`, and terminal events render exactly as today
      (existing `formatStreamEvent` tests untouched).
- [ ] A watch session that receives partials interleaved with other events prints the same lines it
      would have printed with no partials at all.

## Test / verification plan

- Build: `npm run build:cli` succeeds.
- Typecheck: `npm run typecheck` succeeds.
- Lint/format: `npx oxlint <changed files>`, `npx oxfmt --check <changed files>` clean.
- Tests: extend `packages/cli/src/agent-commands.test.ts`'s existing fake-client watch test
  (`agent-commands.test.ts:255-268` idiom) with interleaved partial frames; run
  `npx vitest run packages/cli`.

## Notes

- Independent of tasks 002–005; only needs the `partial` field's type from task 001. May run
  concurrently with everything else after 001 lands.
- `packages/cli/AGENTS.md` is updated in task 007's docs sweep, not here.
