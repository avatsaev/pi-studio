# Task 006 — CLI: suppress partial events in `agent attach`

- **Sprint:** sprint-058-tool-output-streaming
- **Status:** done
- **Type:** feature
- **Area:** packages/cli
- **Priority:** P1
- **Estimated size:** XS
- **Depends on:** task-001
- **Spec re-baselined:** 2026-11-03 against the current tree (anchors only; design unchanged)

## Goal

`pi-studio agent attach` prints nothing for `partial: true` stream events, in both plain
and `--json` render modes.

## Context / why

`attach` (there is no separate `watch` command) uses `attachAgent` in `agent-commands.ts`. Its live
subscription (`client.onSessionMessage`, ≈ L313–321) renders **one line per `agent_stream` event**:
a `tool_call` prints as `[shell running] npm test` via `formatStreamEvent` (≈ L70–111, `tool_call`
rendering ≈ L76–87). Once the daemon starts broadcasting partials (tasks 002–004), a 2-minute bash
command would print the **same line up to 5×/s** for the tool's whole lifetime. `--json` mode is
equally affected and bypasses `formatStreamEvent` entirely (`renderJson(m.event)` ≈ L317), so the
guard must sit at the **subscription site**, before the mode branch — not inside the formatter.

The fetch-based paths (`agent log`, `flattenTimelineItem` ≈ L262 / timeline rendering ≈ L283–293)
need no change: partials never appear in fetched pages (task 004).

Rendering streamed output in the CLI (e.g. an updating line) is **explicitly out of scope** — the
live tail is a web-client affordance; the CLI's job here is only not to degrade.

## Scope references

- `swe/features/tool-output-streaming.md` § Behavior & Algorithms → Client CLI, § Error Handling
  (CLI row)
- `packages/cli/src/agent-commands.ts` ≈ L70–111 — `formatStreamEvent`
- `packages/cli/src/agent-commands.ts` ≈ L313–321 — the `onSessionMessage` subscription in
  `attachAgent`; the existing early return
  `if (m.type !== "agent_stream" || m.agentId !== agentId || !m.event) return;` ≈ L315 and the
  `opts.json` branch ≈ L316
- Modify: `packages/cli/src/agent-commands.ts`, `packages/cli/src/agent-commands.test.ts`

## What to build

One guard in the subscription, immediately after the existing early return and before the
`opts.json` branch:

```
if (m.event.kind === "tool_call" && m.event.partial) return;
```

Nothing else. `formatStreamEvent` stays partial-unaware (it also renders fetched timeline items,
which never contain partials). `m.event` is already typed `AgentStreamEvent` via the local cast at
≈ L314, so `m.event.partial` type-checks after task 001 with no new cast.

## Out of scope

- Any richer CLI rendering of streamed output (updating lines, tails).
- `agent log` / fetched-timeline paths — structurally unaffected.
- `formatStreamEvent` changes (including its `default:` raw-JSON fallthrough for `compaction`,
  which is pre-existing and unrelated).

## Acceptance criteria

- [ ] Pushing a `partial: true` `tool_call` frame through the attach loop produces **no** output line
      in plain mode and **no** JSON line in `--json` mode.
- [ ] Non-partial `tool_call`, `assistant_message`, and terminal events render exactly as today
      (existing `formatStreamEvent` tests untouched).
- [ ] An attach session that receives partials interleaved with other events prints the same lines
      it would have printed with no partials at all.

## Test / verification plan

- Build: `npm run build:cli` succeeds.
- Typecheck: `npm run typecheck` succeeds.
- Lint/format: `npx oxlint <changed files>`, `npx oxfmt --check <changed files>` clean.
- Tests: extend `packages/cli/src/agent-commands.test.ts`'s existing fake-client attach test
  ("attach streams events and exits on a terminal turn event", ≈ L308–322, `fake.push({ type:
  "agent_stream", … })` idiom) with interleaved partial frames; run `npx vitest run packages/cli`.

## Notes

- Independent of tasks 002–005; only needs the `partial` field's type from task 001. May run
  concurrently with everything else after 001 lands.
- `packages/cli/AGENTS.md` is updated in task 007's docs sweep, not here.
