# Task 007 — Web-client Steer composer + queue badge

- **Sprint:** sprint-039-agent-turn-steering
- **Status:** done
- **Estimated size:** M
- **Depends on:** task-005

## Goal
In the web-client composer, replace the primary **Send** action with **Steer** while the agent is
running, wiring it to `client.agent(id).steer(...)`, and surface a "queued" badge on steered user
rows driven by the `queue_update` stream event. (Follow-up is intentionally NOT surfaced in the UI
this pass — steer only.)

## Background / why
Today `Composer.tsx` shows **Send** (disabled only during the brief RPC in-flight window) plus a
**Stop** button when `status === "running"`. But `send_agent_prompt` is only legal when idle, so
there is no way to add instructions mid-turn from the UI. Now that steering exists end-to-end, the
running-state primary action should become **Steer**, reusing the composer's existing
optimistic-echo + reducer-reconciliation flow (the daemon echoes the injected `user_message` with
the same `clientMessageId`, so the optimistic row reconciles exactly as a normal send).

`queue_update` carries the pending steering queue as **strings** (no ids). A steered row is marked
`queued` on optimistic insert and cleared when a `queue_update` no longer lists its text (Pi
delivered it to the LLM) — best-effort text correlation, sufficient for a UX badge.

## Scope references
- `packages/web-client/AGENTS.md` § Composer, § Timeline reducer, § Session store
- `clean-room-scope/features/composer-ui.md` § Submission (add a § Steering)
- `clean-room-scope/features/timeline-rendering.md` § User rows
- Prior daemon/SDK work: sprint tasks 001–006 (steer RPC + SDK `client.agent(id).steer`)

## What to build
- **`timeline/row-model.ts`**: add optional `queued?: boolean` to `UserRow` (only steered rows are
  ever `queued`; a normal send never is).
- **`timeline/reducer.ts`**:
  - `addOptimisticUserMessage` gains a `queued` flag (steer sets it true).
  - `onUserMessage` reconciliation preserves `queued` (only clears `pending`).
  - New `onQueueUpdate(state, steering)`: clear `queued` on any `queued` user row whose `text` is
    NOT present in `steering[]`. Wire `case "queue_update"` in `applyStreamEvent`.
- **`hooks/agent-stream-events.ts`**: confirm `queue_update` routes through `applyStreamEvent` and
  is a no-op in the status switch (no status change on queue updates).
- **`features/chat/Composer.tsx`**:
  - Derive `running = status === "running"`.
  - Extract a shared `submit(mode: "send" | "steer")` from `handleSend`. The steer branch requires
    `agentId` (always present on a running agent), mints `clientMessageId`, calls
    `addOptimisticUserMessage(..., queued:true)`, `await client.agent(agentId).steer(prompt,
    {clientMessageId, images})`, and `markUserMessageFailed` on `{ok:false}` or rejection. It does
    NOT touch `bindAgent` or the first-turn broadcast gate (those are create-path only).
  - Button slot: `running` → **Steer** (distinct icon) + **Stop**; idle → **Send**. `canSubmit`
    keeps the same "non-empty text or images" gate.
  - Enter routes by mode (`running ? steer : send`); Shift+Enter stays newline; placeholder swaps
    while running.
- **`features/chat/rows/UserRow.tsx`** + `rows.module.css`: render a small "queued" badge when
  `row.queued && !row.failed`.

## Out of scope
- Follow-up affordance in the UI (SDK/daemon support it; not surfaced here).
- `set_steering_mode` UI.
- Interactive multi-message queue management.

## Acceptance criteria
- [ ] While running, the composer shows **Steer** (not Send) + Stop; idle shows Send.
- [ ] Steer inserts an optimistic user row (`queued:true`) and calls `client.agent(id).steer`;
  `ok:false`/reject marks the row failed.
- [ ] The daemon's echoed `user_message` reconciles the row in place (no duplicate).
- [ ] A steered row shows a "queued" badge until a `queue_update` drops its text from `steering[]`.
- [ ] Enter routes steer-while-running / send-while-idle; Shift+Enter still inserts a newline.
- [ ] `npm run build:web-client` + `npm run typecheck` pass.

## Test / verification plan
- New `Composer.test.tsx` (mock `useConnectionStore`/`useSessionStore`):
  - idle → Send button, calls `.send`; running → **Steer** button, calls `.steer` with text; Stop
    present.
  - steer inserts optimistic row with `queued:true`; `ok:false`/reject → `markUserMessageFailed`.
  - Enter routes steer-while-running / send-while-idle.
- Reducer tests: `queue_update` clears `queued` when text absent from `steering[]`; `onUserMessage`
  keeps `queued`.
- Smoke: run the web-client against a mock/live daemon, start a turn, steer mid-turn, confirm the
  injected row appears with a queued badge then clears.
- `npx vitest run packages/web-client/src/features/chat/Composer.test.tsx packages/web-client/src/timeline`.

## Notes
- Race: if the turn ends between render and the steer RPC, the daemon returns `ok:false` → row is
  marked failed (same failure surface as a dropped-connection send). Acceptable.
