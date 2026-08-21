# Task 002 — Provider UI channel: contract members + Pi adapter (replace the auto-cancel stub) + mock emitter — Summary

- **Sprint:** sprint-066-extension-ui-rpc
- **Completed:** 2026-08-20
- **Status:** done

## What was implemented

Added the provider-neutral UI channel to `AgentSession`: two optional members (`onUiRequest`,
`respondToUi`) plus the `ProviderUiRequest`/`ProviderUiResponse` interfaces they carry, documented as
provider-scoped ids that must never become a daemon-global map key (task-003 mints its own).

Replaced the Pi adapter's auto-cancel POC stub (`providers/pi/agent.ts:127-142`, which answered every
dialog with `{cancelled: true}` and silently dropped fire-and-forget methods) with a real translation:
a module-level `DIALOG_METHODS` constant (the single place the blocking set is encoded) and a pure
`translateUiRequest` function owning all four adapter responsibilities from the spec — dialog-method
detection, `status:`/`widget:`/`title` surface-key namespacing (proven non-colliding for the shared
`"my-ext"` key), clear-by-omission → `removed: true`, and opaque payload pass-through excluding only
`type`/`id`/`method`. `respondToUi` stamps the envelope body-first, `id`-last
(`{ ...response, id: providerRequestId }`) so a response body carrying its own `id`/`type` cannot
redirect which dialog it resolves. `PI_CAPABILITIES.supportsExtensionUi = true`.

Gave the mock provider the same two members plus test-only scaffolding: a `uiSubscribers` set, a
`uiResponses` recorder for `respondToUi` calls, and `emitUiRequest(partial)` — a scripted emitter with
sensible defaults so tasks 003/004 can drive and assert the whole family with no `pi` child process.
`MockAgentSession` is now exported (it wasn't previously) specifically so tests can reach
`emitUiRequest`/`uiResponses`, which are deliberately outside the provider-neutral contract.
`MOCK_CAPABILITIES.supportsExtensionUi = true`.

## Files created / changed

| File | Change |
|------|--------|
| `packages/server/src/agent/provider-contract.ts` | added `ProviderUiRequest`/`ProviderUiResponse` interfaces + two optional `AgentSession` members (`onUiRequest?`, `respondToUi?`) |
| `packages/server/src/agent/providers/pi/agent.ts` | removed the auto-cancel stub; added `DIALOG_METHODS`, `translateUiRequest`, `uiSubscribers`, `onUiRequest`, `respondToUi`; set `PI_CAPABILITIES.supportsExtensionUi = true` |
| `packages/server/src/agent/providers/pi/pi-adapter.test.ts` | added `UiFakeTransport` (exposes `fire` + captures full `(command, params)` notify pairs) + a `describe("extension UI (sprint-066, task-002)")` block: 12 tests covering the auto-cancel removal, all nine methods, the `"my-ext"` collision proof, clear forms, payload exclusion, timeout mapping, the stamping-order attack, unknown methods, unsubscribe, and non-UI events still flowing |
| `packages/server/src/agent/providers/mock/mock-provider.ts` | exported `MockAgentSession`; added `uiSubscribers`, `uiResponses`, `onUiRequest`, `respondToUi`, `emitUiRequest`; set `MOCK_CAPABILITIES.supportsExtensionUi = true` |
| `packages/server/src/agent/providers/mock/mock-provider.test.ts` | added a `describe("extension UI (sprint-066, task-002)")` block: 3 tests covering capability advertisement, the scripted emitter, response recording, and unsubscribe |

## How it satisfies the scope

Maps to `swe/features/extension-ui-rpc.md` § Provider contract extension (all four adapter
responsibilities) and § Behavior & algorithms (the `PiAgentSession` pseudocode). Field names
(`statusKey`, `statusText`, `widgetKey`, `widgetLines`, `widgetPlacement`, `notifyType`, `timeout`)
verified against the installed build's `node_modules/@earendil-works/pi-coding-agent/docs/rpc.md`
§ Extension UI Protocol (lines 1155-1345), not upstream docs. `ctx.ui.custom()` has no branch — Pi
returns `undefined` in-process, so there is nothing on the wire to translate. No change to
`getPendingPermissions`/`respondToPermission` (dormant permission family untouched, per scope). No
service, RPC handler, or bootstrap wiring — that's task-003/task-004, correctly out of scope here.

## Build & test results

```
$ npx tsc --noEmit -p packages/server        # incremental check during implementation
(success, zero errors)

$ npx vitest run packages/server/src/agent/providers
Test Files  4 passed (4)
     Tests  88 passed (88)

$ npx oxlint <changed files>
2 warnings, both pre-existing (verified: identical before this change) — mock-provider.ts:287
no-array-reverse (untouched line, not in this task's diff) and none introduced; one self-inflicted
no-unused-vars caught and fixed during this task (a destructured `expectsResponse` that was only
needed as a map key, not a loop-body value) before the final lint pass

$ npx oxfmt --check <changed files>
clean (2 files needed a scoped `npx oxfmt <files>` fix, then verified clean)

$ npm run clean && npm run typecheck   # forced full rebuild
tsc -b
(success, zero errors)

$ npm run build                        # full monorepo build (protocol → … → cli)
(success)

$ npm test                             # full monorepo suite
Test Files  168 passed (168)
     Tests  2133 passed (2133)
```

## Acceptance criteria

- [x] The auto-cancel block at `providers/pi/agent.ts:127-142` is gone; no code path writes an
      `extension_ui_response` except `respondToUi` — verified by the "auto-cancel POC is gone" test
      and by code inspection (the only `transport.notify("extension_ui_response", …)` call site is
      `respondToUi`).
- [x] All nine documented methods translate to the correct `expectsResponse` — verified by the
      nine-method fixture test.
- [x] `setStatus{statusKey:"my-ext"}` → `"status:my-ext"`; `setWidget{widgetKey:"my-ext"}` →
      `"widget:my-ext"`; `setTitle` → `"title"`; both `"my-ext"` cases asserted together, proving
      non-collision — verified.
- [x] `notify`/`set_editor_text` produce no `surfaceKey` — verified.
- [x] Clear-by-omission sets `removed: true`; present values leave it falsy — verified for both
      `setStatus`/`setWidget`.
- [x] `payload` excludes `type`/`id`/`method`, retains every other field verbatim — verified across
      `select`/`notify`/`setWidget` fixtures.
- [x] `timeoutMs` populated from `timeout` when present, absent otherwise — verified.
- [x] `respondToUi` envelope stamping: entry's own `id` wins even when the response body carries its
      own `id`/`type` — verified against `UiFakeTransport`'s captured `(command, params)` pair.
- [x] Unknown method emits `expectsResponse: false`, no `surfaceKey`, does not throw — verified.
- [x] `onUiRequest`'s `Unsubscribe` detaches the callback — verified for both providers.
- [x] Mock provider emits scripted requests, records `respondToUi` calls, both providers advertise
      `supportsExtensionUi: true` — verified.

## Follow-ups / TODO(verify)

- Buffering UI events emitted before the first subscriber attaches was explicitly deferred (sprint's
  open question) — task-006's live run against a real `pi` process is the designated place to prove
  whether the race is real before adding a queue.
- No reachable surface yet by design — `AgentUiService` (task-003) and the attach hook/RPC
  handlers/bootstrap wiring (task-004) are what make this channel observable to a client.
