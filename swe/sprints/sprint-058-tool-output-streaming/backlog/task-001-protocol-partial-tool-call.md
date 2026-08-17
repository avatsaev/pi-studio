# Task 001 — Protocol: optional `partial` on the `tool_call` stream event

- **Sprint:** sprint-058-tool-output-streaming
- **Status:** backlog
- **Type:** feature
- **Area:** packages/protocol
- **Priority:** P1
- **Estimated size:** XS
- **Depends on:** none

## Goal

Add one optional boolean field, `partial`, to the `tool_call` branch of `agentStreamEventSchema`, so
the daemon can mark an in-flight output snapshot as ephemeral without introducing a new event kind.

## Context / why

This is the whole wire surface of the sprint — deliberately one field. The reason a new `kind` was
rejected: the web client's `mergeTool()` upsert already replaces `output` with the latest non-empty
value for a given `callId` (`packages/web-client/src/timeline/reducer.ts:116-123`), so an
**unmodified** client renders streamed output correctly the moment the daemon starts sending it. A
new kind would mean every consumer needs a new case before anything renders at all.

`partial` is what separates "ephemeral snapshot" from "real timeline row" for the two consumers that
must treat them differently: the persistence branch (task 004) and the coalescer (task 003). It is
**not** copied onto the client's row model — it describes the delivery, not the tool call.

No `ToolCallDetail` change: the snapshot travels in the existing `output` field, which every tool
kind already has (`messages.ts:225-254`).

`agent_stream.seq` is **already** optional (`messages.ts:311`), so the no-`seq` ephemeral broadcast
in task 004 needs no schema change here. Verify this rather than re-adding it.

## Scope references

- `swe/features/tool-output-streaming.md` § Public Contract → Protocol amendment, § Design tenets 1–2
- `swe/architecture/websocket-protocol.md` — append-only rules
- `packages/protocol/src/messages.ts:285-290` — the `tool_call` branch to extend
- `packages/protocol/src/messages.ts:308-314` — `agentStreamSchema` (confirm `seq` optional)
- Modify: `packages/protocol/src/messages.ts`, `packages/protocol/src/session-messages.test.ts`

## What to build

The `tool_call` branch gains one field:

```ts
z.object({
  kind: z.literal("tool_call"),
  callId: z.string().optional(),
  tool: toolCallDetailSchema,
  status: z.string().optional(),
  /** ephemeral in-flight snapshot: not persisted, carries no seq, superseded by the next event */
  partial: z.boolean().optional(),
})
```

Document in the schema comment what `partial: true` obliges of a producer (no `seq`, never appended
to the timeline) and of a consumer (upsert by `callId`; supersede, never accumulate) — the field is
meaningless without that contract, and the comment is the only place a client author will read it.

Leave `status` an open string. It already is, and partials use the existing `"running"` value.

## Out of scope

- Mapper, coalescer, persistence, client (tasks 002–005).
- Any change to `ToolCallDetail` or a new `kind`.
- Any narrowing of `status` into an enum.

## Acceptance criteria

- [ ] A `tool_call` event validates **with** `partial: true`, **with** `partial: false`, and
      **without** the field, producing an unchanged parse for the last case.
- [ ] An `agent_stream` envelope validates **without** `seq` (proving the ephemeral shape needs no
      schema change) and with `seq` present.
- [ ] The existing `AgentStreamEvent` discrimination test
      (`session-messages.test.ts:139`) still passes untouched; all 10 kinds still discriminate.
- [ ] No existing field is removed, renamed, or narrowed; `partial` is optional.
- [ ] The schema comment states the producer/consumer obligations (no `seq`, no persistence,
      supersede-not-accumulate).

## Test / verification plan

- Build: `npm run build:protocol` succeeds.
- Typecheck: `npm run typecheck` succeeds.
- Lint/format: `npx oxlint <changed files>`, `npx oxfmt --check <changed files>` clean.
- Tests: extend `packages/protocol/src/session-messages.test.ts`; run
  `npx vitest run packages/protocol`.

## Notes

- Root invariant 1 (append-only) and invariant 2 (protocol has zero workspace imports) both apply —
  this task adds a field and nothing else.
- Do not add a `COMPAT(...)` tag: this is a new optional field, not a back-compat shim.
