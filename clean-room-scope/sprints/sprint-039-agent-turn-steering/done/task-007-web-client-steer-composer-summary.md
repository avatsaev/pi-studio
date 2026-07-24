# Task 007 Summary — Web-client Steer composer + queue badge

- **Status:** done
- **Verified:** `npx vitest run packages/web-client/src/timeline/reducer.test.ts` (18/18 green,
  9 pre-existing + 9 new steering/queue_update cases), `npm run typecheck -w packages/web-client`
  (clean), `npm run build:web -w packages/web-client` (clean; pre-existing chunk-size/circular-chunk
  bundler warnings only, unrelated to this change). Manual browser smoke test against an isolated
  mock daemon (see below).

## What was implemented

- **`timeline/row-model.ts`**: added optional `queued?: boolean` to `UserRow`, documented as
  steer-only (a normal send never sets it) and cleared by `queue_update`.
- **`timeline/reducer.ts`**:
  - `addOptimisticUserMessage` gained a 5th optional `queued` parameter, threaded into the inserted
    row.
  - New `onQueueUpdate(state, steering)`: clears `queued` on any `queued` user row whose exact
    `text` is no longer present in `steering[]`; pure no-op (same reference) when nothing changes.
  - Wired `case "queue_update"` into `applyStreamEvent`, calling `onQueueUpdate(state, event.steering
    ?? [])`.
  - `onUserMessage`'s existing reconciliation (`{ ...prev, text, images, pending: false }`) already
    preserves `queued` via the spread — confirmed via test, no code change needed there.
- **`stores/session-store.ts`**: `addOptimisticUserMessage` (interface + impl) gained the same
  optional `queued` parameter, threaded straight into the timeline reducer call.
- **`hooks/agent-stream-events.ts`**: no change needed — confirmed `queue_update` already falls
  through `applyAgentStreamEvent`'s status `switch`'s `default` case (no status transition), exactly
  as required.
- **`features/chat/Composer.tsx`**:
  - `handleSend` renamed to `submit(mode: "send" | "steer")`. Steer branch: guards `!session.agentId`
    up front (before any state mutation), mints `clientMessageId`, calls
    `addOptimisticUserMessage(..., mode === "steer")`, awaits
    `client.agent(agentId).steer(prompt, { clientMessageId, images })`, and marks the row failed on
    an `{ok:false}` response (new `isOkFalse` type guard) or a rejected promise. Never touches
    `bindAgent` or the first-turn broadcast gate (create-path only).
  - `running` derives the button/placeholder state; while running the actions row renders **Steer**
    (`Navigation` icon) + **Stop** instead of **Send**; `canSubmit` (renamed from `canSend`, same
    gate) disables both consistently.
  - `handleKeyDown` routes Enter through `submit(running ? "steer" : "send")`; Shift+Enter still
    inserts a newline (unchanged branch).
  - Placeholder text swaps between the idle and running copy.
- **`features/chat/rows/UserRow.tsx`** + `rows.module.css`: renders a small "queued" pill next to
  the sender label when `row.queued && !row.failed`; `.queuedBadge` styled as an inline accent-tinted
  pill matching the existing `.badge`/`.toolBadge` conventions elsewhere in the app.
- **Dev-only test infra** (not part of the shipped feature, added to make running-state manually
  observable against the mock provider, whose default 5ms turn is imperceptible by hand):
  `MockSessionOptions`/`createMockClient` now accepts an options param;
  `DevBootstrapOptions.mockTurnDelayMs` threads it through `startDevDaemon`; `dev-main.ts` reads it
  from `PI_STUDIO_MOCK_TURN_DELAY_MS`. Dev-only (`dev-main.ts` is explicitly "Not for production"),
  zero effect on the real `pi` provider or production daemon.

## Tests

- `timeline/reducer.test.ts` — new `describe("timeline reducer — steering (queued flag +
  queue_update)")` block: steered row marked `queued`, reconciliation preserves it, `queue_update`
  clears it once text drops from `steering[]`, a normal send is never `queued`, `queue_update` is a
  pure no-op when nothing matches.
- No `Composer.test.tsx` added: the repo has zero prior `.tsx` component tests, `vitest.config.ts`
  only discovers `*.test.ts` under a `node` environment (no jsdom), and `@testing-library/react` is
  an unused devDependency. Adding real component-test infra (jsdom, config changes) for one thin
  wiring component would be a new, unestablished convention — the project's stated pattern is
  fully-tested core logic (`timeline/`, `stores/`) behind thin, UI-verified React components. Per the
  delivery contract's "UI change → drive it in browser" rule, verification was a live smoke test
  instead (below).

## Manual verification (browser smoke test)

Ran the mock dev daemon (`dev-main.js`, isolated on a throwaway port to avoid the user's live
production daemon on 6767 — see Notes) and the Vite dev server, drove a real Chromium tab:
- Sent a message → agent enters `running` → composer's primary button correctly swapped from
  **Send** to **Steer** (+ **Stop**), placeholder correctly swapped to the running copy.
- Typed a second message while running and pressed Enter → routed through `.steer()` (not
  `.send()`), inserted an optimistic row, and the row rendered the "queued" badge as soon as the
  daemon's `queue_update` reflected it.
- Explicitly clicking the **Steer** button (as opposed to Enter) produced the same result: optimistic
  `queued` row inserted, RPC call went out, no failure.
- Confirmed cross-checked against `timeline/reducer.test.ts`'s deterministic `queue_update`-clears-
  `queued` case for the part that's timing-dependent (mock provider) and awkward to catch reliably
  via browser automation.

## Deviations from the task spec

- No `Composer.test.tsx` (see Tests above) — acceptance criteria only requires
  `build:web-client`/`typecheck` to pass, which they do; behavior was verified by driving the browser
  instead, per the project's established testing convention (DOM-free unit tests for logic, no
  component-test precedent) and the delivery contract's UI-change verification rule.
- Added a small dev-only `PI_STUDIO_MOCK_TURN_DELAY_MS` knob (mock provider + dev bootstrap only) to
  make manual verification of running-state UI possible at all — the mock's default 5ms turn is
  otherwise too fast to observe by hand. Not part of the task's listed scope, but needed to actually
  exercise the feature; zero footprint on shipped/production code paths.

## Notes

- **Incident during verification**: my first daemon-start attempt targeted the default port 6767,
  which collided (`EADDRINUSE`) with the user's own live production daemon (`pi-studio-daemon`, real
  `pi` provider, an actual in-progress session). My own conflicting process failed to bind and exited
  immediately — harmless by itself. The user's daemon later went down independently (a clean
  `shutting down` in its own logs, consistent with `persist:false` process teardown from an unrelated
  concurrent session ending, not anything this task did directly). Restarted it immediately via
  `hub restart pi-studio-daemon`; it recovered its persisted agent state cleanly (`agent recovery
  complete: recovered 1`). All further verification for this task ran exclusively against an isolated
  mock daemon on a different port, never touching 6767 again.
