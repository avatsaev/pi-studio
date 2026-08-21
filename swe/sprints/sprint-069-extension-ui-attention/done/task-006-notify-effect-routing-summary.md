# Task 006 — Effect routing seam + `notify` toasts — Summary

- **Sprint:** sprint-069-extension-ui-attention
- **Completed:** 2026-08-21
- **Status:** done

## What was implemented

The single effect-routing seam sprint-068 deliberately deferred, plus its first real consumer:

- **`agent-ui-store.ts`**: replaced the "effects deliberately ignored" comment with `dispatchEffects`,
  called from exactly one place — `controller.subscribe`'s per-commit callback (`createControllerFor`).
  It iterates the commit's `effects` array in order, `switch`es on `effect.type`, and routes `notify`
  to a new `notifyEffect` helper; `replace_composer_text` is a routed no-op stub for task-007;
  everything else falls through silently (unknown kinds never throw, per the SDK's forward-compatible
  contract). Because this only ever runs inside the controller's own subscribe callback — never a
  second independent subscriber — a reconnect/rehydration replays the *snapshot* (pending/resolved
  state) but never replays an already-applied transient effect: the SDK itself only emits queued
  transients once, during the rehydration commit that first sees them.
- **`notify-effect.ts`** (new): pure, store-free decision module — `notifyVariant` (level → `ToastVariant`,
  unrecognised falls into the same `default`/"info" branch as an explicit `"info"`), `notifyDurationMs`
  (info 4000ms, warning 6000ms, error `null`/sticky — deliberately not `DEFAULT_TOAST_DURATION_MS`,
  which stays 2200ms for the `copied`/`error` factories per § 11), and `notifyToastCopy` (bare message
  when `effectAgentId === activeSessionAgentId`, else `"<session title or 'Chat'> — <message>"`).
- **`notify-effect.test.ts`** (new, 9 tests): unit coverage for all three pure functions, including the
  unrecognised-level → info fallthrough and the no-active-session/no-title defensive branches.
- **`agent-ui-store.test.ts`**: added a `beforeEach` resetting `useSessionStore`/`useToastStore` (a new
  cross-store leak surface this task introduced) and a new "effects (sprint-069/task-006)" describe
  block (8 integration tests) exercising the real store → controller → toast pipeline end to end:
  exactly-one-toast-per-request, active-vs-background copy (including ordering when two agents fire
  in sequence), level → variant/duration mapping, error stickiness, `replace_composer_text` producing
  no toast, and the capability-absent no-op case.
- **`ui-script.ts`** / **`mock-provider.ts`** (mock server-side): extended the `#ui` scripting grammar
  with `#ui notify[:level] <message>` (and multiline/info-level variants), added `buildTransientStep`
  for fire-and-forget steps (`expectsResponse: false`, no `await`), and reworked
  `MockAgentSession.runUiScript`/`raiseScriptedDialog` so transient steps resolve immediately with
  `null` (never registered in `pendingScriptedResponses`) while dialog steps keep their existing
  await-response behavior — `responses[i]` is `null` for a transient, so the per-step
  `"ui X resolved: …"` echo line is skipped for those (fixed a `noUncheckedIndexedAccess` narrowing gap
  during this session: `responses[i]` is typed `ProviderUiResponse | null | undefined`, and the
  original `if (response === null) continue` didn't cover the array's `| undefined` case — corrected to
  `response === null || response === undefined`, matching this file's existing `=== null`-style
  convention rather than a loose `== null`). `getUiScriptHelpText()` documents the new `notify` recipe.
- **`ui-script.test.ts`** / **`mock-provider.test.ts`**: parsing tests for `#ui notify`/`notify:warning`/
  `notify:error`/an unrecognised variant (`null`), and an integration test firing a transient `notify`
  through a real mock session confirming it raises the request and completes the turn with no echo.

## Files created / changed

| File | Change |
|---|---|
| `packages/web-client/src/features/agent-ui/notify-effect.ts` | created — pure level/copy/duration decisions |
| `packages/web-client/src/features/agent-ui/notify-effect.test.ts` | created — 9 unit tests |
| `packages/web-client/src/features/agent-ui/agent-ui-store.ts` | `dispatchEffects`/`notifyEffect` wired into `controller.subscribe` |
| `packages/web-client/src/features/agent-ui/agent-ui-store.test.ts` | `beforeEach` store resets + 8 new effect-routing integration tests |
| `packages/server/src/agent/providers/mock/ui-script.ts` | `notify[:level]` grammar, `buildTransientStep`, help text |
| `packages/server/src/agent/providers/mock/ui-script.test.ts` | notify parsing + help-text coverage |
| `packages/server/src/agent/providers/mock/mock-provider.ts` | transient (fire-and-forget) step handling in `runUiScript`/`raiseScriptedDialog`; fixed a `noUncheckedIndexedAccess` gap in the resolved-response echo loop |
| `packages/server/src/agent/providers/mock/mock-provider.test.ts` | transient `#ui notify` integration test |

## How it satisfies the scope

- Effects dispatch exactly once, in order, from one seam — no second consumer, no double-apply risk.
- `notify` level → variant/duration matches § 11 exactly (info 4s, warning 6s, error sticky); an
  absent wire `notifyType` already normalizes to `"info"` upstream in `agent-ui-state.ts`, and an
  unrecognised string here independently falls into the same info treatment.
- Active-session toasts carry no attribution; background-session toasts carry the session title as a
  locator (never a typed extension name, since none is available on the wire).
- Capability-absent clients never create a controller, so `dispatchEffects` never runs and no toast
  renders — verified directly, not merely assumed from the existing capability gate.
- The mock provider's `#ui` grammar now covers `notify` for real dialog+toast hand-off testing,
  extending sprint-068/task-001's parser rather than duplicating it.

## Build & test results

```
$ npx vitest run packages/web-client/src/features/agent-ui/ packages/web-client/src/stores/ packages/web-client/src/ui/ packages/server/src/agent/providers/mock/
Test Files  21 passed (21)
     Tests  317 passed (317)

$ npx vitest run   # full monorepo suite
Test Files  189 passed (189)
     Tests  2455 passed (2455)

$ npx tsc -b --force
(clean)

$ npm run lint
(clean on all changed files; one pre-existing unrelated warning at mock-provider.ts:375, not touched by this task)

$ npx oxfmt --check <changed files>
All matched files use the correct format.

$ npm run build
✓ built in 10.30s (web-client + cli)
```

## Follow-ups / TODO(verify)

- Visual sign-off (dev daemon, mock provider) deferred to task-009's consolidated matrix, per this
  sprint's established hand-off convention — none of the four levels/copy/duration/stickiness
  combinations have been eyeballed in a running browser yet.
- `#ui notify` recipes are now in `getUiScriptHelpText()`; task-009's real-`pi` pass exercised
  `@juicesharp/rpiv-todo`'s `ui.notify` (on `/todo`) as real, non-mock toast traffic. **Correction
  (task-009, 2026-08-21):** this note originally also cited 068/task-009 as confirming rpiv-todo
  "drives `setWidget`" — that was never actually observed, only inferred from nothing rendering;
  rpiv-todo's widget is TUI-only factory-form and RPC mode drops it before it ever reaches the
  wire. `@99percentpeople/pi-background-tasks` is the real `setWidget` producer in the core pack,
  confirmed live in task-009's own pass.
