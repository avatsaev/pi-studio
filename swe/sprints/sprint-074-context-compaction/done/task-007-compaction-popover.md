# Task 007 — Web-client: Popover primitive, shared compact action, meter popover

- **Sprint:** sprint-074-context-compaction
- **Status:** done
- **Type:** feature
- **Area:** packages/web-client (components/primitives, stores, features/workspace)
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** task-004, task-006

## Goal

Clicking the context meter opens a popover with exact usage, an optional instructions field and a
single **Compact now / Cancel** button. One shared `compactSession` action is introduced here so the
composer's `/compact` (task-008) uses the same code path.

## Context / why

The UI has no popover primitive. `@radix-ui/react-popover` is a dependency but unused, and the
overlay convention is "wrap Radix in `components/primitives/`" (`Dialog.tsx`, `Menu.tsx`). A
`DropdownMenu` is wrong here because its typeahead and focus model fight a text input.

The action must work against daemons **without** `compactionEvents` (the hosted web UI at
app.molagent.ai talks to older self-hosted daemons). There it drives the in-progress state from a
local pending flag and the estimate from the RPC response.

## Scope references

- `swe/features/context-compaction.md` § Public contract › Web-client (Compacting selector, Compact
  action, Popover primitive, Stats estimate), § UI specification › Compaction popover, § Error
  handling & edge cases
- `packages/web-client/src/components/primitives/Dialog.tsx`, `Menu.tsx` + `.module.css` — wrapper
  and surface conventions; `Button.tsx`, `TextInput.tsx`, `Spinner.tsx`
- `packages/web-client/src/features/chat/use-fork-action.ts:37-38` — reading
  `serverInfo.features[...]`
- `packages/web-client/src/features/chat/Composer.tsx:396` — `client.agent(agentId).interrupt()`
- `packages/web-client/src/stores/fork-store.ts` — a small per-feature in-flight store precedent
- `packages/web-client/src/features/workspace/ContextMeter.tsx`, `context-meter.ts`,
  `useIsCompacting` (task-006)
- `packages/client/src/pistudio-client.ts` `compact()` with the long timeout (task-004)

## What to build

- **`components/primitives/Popover.tsx`** (+ CSS): a thin wrapper exporting `Popover.Root/Trigger`
  passthroughs and a styled `PopoverContent` (portal, side/align props, the `Menu` surface tokens,
  collision padding). Add it to `primitives/index.ts`.
- **`stores/compaction-store.ts`**: `pendingBySession: Record<string, true>` and
  `lastErrorBySession: Record<string, string>`, plus `compactSession(sessionId, instructions?)`:
  - preconditions: client connected, session has `agentId`, status not `running`, not
    compacting. Otherwise it returns a typed refusal without sending anything.
  - sets pending and clears the last error, then calls `client.agent(agentId).compact(instructions)`.
  - on success **without** `compactionEvents`, applies the estimate from the response through the
    same stats writer task-006 uses for the live event.
  - on failure, stores the RPC error message. Always clears pending.
  - `cancelCompaction(sessionId)` → `client.agent(agentId).interrupt()`.
- **`useIsCompacting`**: OR the local pending flag in.
- **Meter popover** (`features/workspace/ContextMeterPopover.tsx`): the `ContextMeter` becomes the
  trigger, wrapped in a reset `<button>` with an action `aria-label`. Content: the meter at full
  width with `84.1k / 200k (42%)` (estimate wording when estimated), an optional multi-line
  instructions field, the inline last error, and one button in priority order:
  compacting → **Cancel**; running → disabled `Compact now` + `Wait for the agent to finish`;
  no `agentId` → disabled + `Nothing to compact yet`; otherwise **Compact now**. Instructions clear
  on success and survive failure. The popover stays open during compaction and returns focus to the
  trigger on close.
- Docs: `packages/web-client/AGENTS.md` (Popover primitive, compaction store and fallback rule);
  `swe/features/ui-components.md` overlay list gains Popover.

## Out of scope

- Composer gating and `/compact` (task-008).

## Acceptance criteria

- [x] `compactSession` refuses without sending when there is no agent, the agent is running, or a
      compaction is pending or in progress. Otherwise it sends exactly one `agent_compact_request`
      with the instructions.
- [x] Pending is cleared on success and on failure, and failure stores the daemon's message.
- [x] With `compactionEvents` absent, success writes the response's estimate to stats. With it
      present, the response does not write stats (the live event already did, so no
      double-apply).
- [x] Popover button states match the priority table. **Cancel** calls `interrupt` for that agent.
- [x] In a browser (dev daemon): open the popover, type instructions, Compact now → the button
      becomes Cancel, the divider appears, and both settle. A second window shows the same divider
      and meter state. Escape/outside click closes and focus returns to the meter.

## Test / verification plan

- Tests: `stores/compaction-store.test.ts` (preconditions, single send, pending lifecycle, error
  capture, capability fork for the estimate) with a fake client.
- Run: `npx vitest run packages/web-client` and `npm run build:web-client`.
- Manual: browser check above, with two windows. Record it.

## Notes

- `TODO(verify)` from the spec: the exact `busy` wording comes from task-003. Display the daemon's
  message verbatim rather than mapping codes.
