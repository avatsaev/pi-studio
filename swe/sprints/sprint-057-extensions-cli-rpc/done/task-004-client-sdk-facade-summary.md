# Task 004 — `PiStudioClient` facade: `listExtensionPacks` / `setExtensionPacks` — Summary

- **Sprint:** sprint-057-extensions-cli-rpc
- **Completed:** 2026-08-13
- **Status:** done

## What was implemented

Three thin `PiStudioClient` facade methods wrapping `this.daemon.request(...)`:
`listExtensionPacks()`, `setExtensionPacks(packs, opts?)`, `syncExtensionPacks(opts?)`. Placed
adjacent to `providers`/`onAgentUpdate` (daemon-scoped, not agent/session-scoped). `packs` is typed
from `@av-pi-studio/protocol`'s `ExtensionPacksListResponse`/`ExtensionPacksSetResponse` — no locally
redeclared payload shapes. `syncExtensionPacks` omits the `packs` key from the request params object
entirely (not `packs: []`, a materially different request meaning "deselect everything"). No
client-side slug validation, caching, or retry logic.

Implemented by a delegated subagent under this session; independently re-verified and **two test
gaps fixed** before acceptance (see below).

## Files created / changed

| File | Change |
|------|--------|
| `packages/client/src/pistudio-client.ts` | added `listExtensionPacks`/`setExtensionPacks`/`syncExtensionPacks`, extended the `@av-pi-studio/protocol` type-only import |
| `packages/client/src/pistudio-client.test.ts` | added `describe("PiStudioClient — extension pack actions (sprint-057)")` — 6 tests; fixed the scripted-daemon responses and two weak assertions (see below) |

## Corrections made during review (before acceptance)

The subagent's scripted test-daemon wrapped the `extension_packs_list_response`/
`extension_packs_set_response` fields under a `payload: {...}` key. That does **not** match the real
wire schema (`packages/protocol/src/messages.ts`, task-001) — those two response types carry their
fields flat on the message, unlike several older RPCs in this file that legitimately do use a
`payload` wrapper. The tests happened to still pass only because `DaemonClient.resolvePending`
special-cases a `payload` key when present; the scripted fixture was silently testing a fictional
wire shape. Fixed: both scripted responses are now flat, matching the real schema, and the mock
`extension_packs_set_request` handler answers `ok: false` for a `packs: ["unknown"]` request so an
`ok: false` scenario is actually reachable.

Two acceptance-criteria tests were present but not actually testing their claim:
- The `opts.timeoutMs` test only asserted the call resolved without throwing — it never checked the
  value reached `request`'s third parameter. Replaced with a `vi.spyOn(daemon, "request")` assertion
  checking the exact third argument across three calls (`setExtensionPacks` with/without `timeoutMs`,
  `syncExtensionPacks` with `timeoutMs`), including that omitting it passes `undefined` through
  (leaving the client's default `rpcTimeoutMs` in force).
- The `ok: false` test asserted only that *some* object came back, with a code comment admitting "the
  mock transport currently replies with ok:true for all requests." Replaced with a real `ok: false`
  round-trip once the scripted daemon could answer one.

## How it satisfies the scope

Matches the task's exact method signatures and every acceptance criterion in
`swe/sprints/sprint-057-extensions-cli-rpc/backlog/task-004-client-sdk-facade.md`. No scope
deviations; the corrections above are test-fidelity fixes, not implementation changes — the three
production methods were correct as written.

## Build & test results

```
$ npm run build:client
> tsc -b packages/client
(success)

$ npx oxfmt --check packages/client/src/pistudio-client.ts packages/client/src/pistudio-client.test.ts
All matched files use the correct format.

$ npx oxlint packages/client/src/pistudio-client.ts packages/client/src/pistudio-client.test.ts
(clean, no warnings)

$ npx vitest run packages/client
Test Files  6 passed (6)
     Tests  62 passed (62)   [pistudio-client.test.ts: 17 passed, up from 11 baseline]
```

## Acceptance criteria

- [x] `listExtensionPacks()` sends `extension_packs_list_request` with `{}` and returns the parsed
      response payload unchanged.
- [x] `setExtensionPacks(["swe"])` sends `extension_packs_set_request` with `{ packs: ["swe"] }`.
- [x] `syncExtensionPacks()` sends `extension_packs_set_request` with no `packs` key at all.
- [x] `opts.timeoutMs` reaches `request`'s third parameter; omitting it leaves the client default in
      force — asserted on a fake transport via a `daemon.request` spy, not wall-clock waiting.
- [x] An `ok: false` response is returned to the caller as data — not thrown.
- [x] All three methods are exported on the public surface and typed from `@av-pi-studio/protocol`.

## Follow-ups / TODO(verify)

- None.
