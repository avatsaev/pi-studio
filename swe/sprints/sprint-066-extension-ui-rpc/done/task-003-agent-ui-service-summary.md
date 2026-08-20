# Task 003 — `AgentUiService`: wire-id minting, pending map, surface retention, first-wins resolution — Summary

- **Sprint:** sprint-066-extension-ui-rpc
- **Completed:** 2026-08-20
- **Status:** done

## What was implemented

Built `AgentUiService` (`packages/server/src/agent/agent-ui/agent-ui-service.ts`), the only stateful
piece of the extension-UI bridge, implementing the spec's normative pseudocode: daemon-minted wire
ids (`pending: Map<wireId, {agentId, providerRequestId, session, method, payload, surfaceKey?,
timeoutMs?, createdAt, timer?}>`), namespaced surface retention with clear-by-omission
(`surfaces: Map<agentId, Map<surfaceKey, AgentUiSurface>>`), first-answer-wins `respond()`,
non-answering `expire()` (Pi already self-resolved), and `sweep()` for session-terminal events only.

`attach(agentId, session)` sweeps first (`"aborted"`) before subscribing — the leading sweep is what
stops a forced respawn from leaving undead dialogs whose provider ids belong to a dead process. A
session without `onUiRequest` attaches silently. `sweep()` cancels toward **the entry's own captured
session** (never a freshly attached one), then calls the stored channel `Unsubscribe` *before*
dropping it, so a post-sweep emission from a dying session cannot resurrect a surface for an
archived agent. `respond()` deletes the pending entry, calls `respondToUi` inside `try`/`finally`,
and broadcasts `agent_ui_resolved` unconditionally from the `finally` — a throw (dead stdin after a
crash) still resolves the dialog for every other client instead of leaving a ghost.

Logging is structural-only (`agentId`/`requestId`/`method`/`err`) — never `payload` or `response` —
per the spec's secret-handling rule (an `input` dialog can carry a token an extension asked for). An
unknown method is logged once per `(agentId, method)` pair at `info`, using a small `KNOWN_METHODS`
constant deliberately duplicated (not imported) from task-002's adapter vocabulary, so this service
stays provider-agnostic per root `AGENTS.md`'s provider-isolation invariant — this is the one
sanctioned exception to "no method string comparison" the task calls out.

## Files created / changed

| File | Change |
|------|--------|
| `packages/server/src/agent/agent-ui/agent-ui-service.ts` | new — `AgentUiService` + `AgentUiServiceDeps` |
| `packages/server/src/agent/agent-ui/agent-ui-service.test.ts` | new — 16 tests using `MockAgentSession` (task-002's scripted emitter) for the happy paths and minimal `as unknown as AgentSession` fakes (matching `archive.test.ts`/`session-ops.test.ts` convention) for the `unsupported`/throwing/no-`onUiRequest` edge cases |

## How it satisfies the scope

Implements `swe/features/extension-ui-rpc.md` § Behavior & algorithms' `AgentUiService` pseudocode
verbatim (attach/onProviderRequest/respond/expire/sweep), § Data & persistence touchpoints (nothing
persisted — in-memory, dies with the daemon, correctly, since the Pi processes holding those dialogs
die with it too), and § Error handling & edge cases (every row in that table has a corresponding
test). No RPC handler registration, no `AgentManager.onSessionAttached` hook, no MCP tools, no
persistence — all correctly deferred to tasks 004/005 per this task's own "Out of scope".

**One deliberate extension beyond the task's literal "State:" section**: the pseudocode's minimal
`pending[wireId] = { agentId, providerRequestId, session }` omits fields `listPending()` must
actually return (`method`, `payload`, `surfaceKey?`, `timeoutMs?`, `createdAt`) to satisfy the
`AgentUiPendingRequest` wire contract task-001 defined. The internal `PendingEntry` carries these
additional fields; this is a necessary implementation completion, not a design deviation — the
pseudocode elides them for brevity the way it elides `now` computation, not as a contract exclusion.

## Build & test results

```
$ npx tsc --noEmit -p packages/server     # incremental checks during implementation
(caught and fixed a real bug: `attach(agentId, session)`'s `session` parameter was first typed as
 the WS `Session` instead of the provider-neutral `AgentSession` — task-002's `onUiRequest`/
 `respondToUi` live on `AgentSession`, not `Session`. Fixed before any test ran.)

$ npx vitest run packages/server/src/agent/agent-ui
Test Files  1 passed (1)
     Tests  16 passed (16)

$ npx oxfmt --check <changed files>
clean (2 files needed a scoped `npx oxfmt <files>` fix, then verified clean)

$ npx oxlint <changed files>
0 warnings, 0 errors — the new files are lint-clean

$ npm run build:server
tsc -b packages/server
(success)

$ npm run clean && npm run typecheck      # forced full rebuild
tsc -b
(success, zero errors)

$ npm run build                           # full monorepo build
(success)

$ npm run lint                            # full monorepo lint
exit 0, 0 errors (only pre-existing warnings elsewhere, none in this task's files)

$ npm test                                # full monorepo suite
Test Files  169 passed (169)
     Tests  2149 passed (2149)
```

## Acceptance criteria

- [x] A dialog request becomes exactly one pending entry and one broadcast whose `requestId` is not
      the provider's id — verified.
- [x] Two sessions emitting the same provider-scoped id yield two independent, independently
      answerable pending entries — verified.
- [x] A fire-and-forget request is broadcast but never pending; answering it returns `not_found` —
      verified.
- [x] `respond` forwards the answer verbatim with the entry's provider id, broadcasts
      `reason:"answered"` — verified.
- [x] Two concurrent answers: first `ok:true`, second `not_found`, provider spy received exactly one
      response — verified.
- [x] A session lacking `respondToUi` yields `unsupported` — verified against a minimal fake missing
      that member.
- [x] A `respondToUi` that throws still returns `ok:true` and still broadcasts `agent_ui_resolved` —
      verified (try/finally).
- [x] Surface retention: last-value-wins per `surfaceKey`, `listSurfaces` returns the newest payload
      and `updatedAt` — verified.
- [x] `removed: true` deletes the surface, still broadcasts, key absent from `listSurfaces` —
      verified.
- [x] `status:x`/`widget:x` coexist as two surfaces — verified end to end (service treats them as
      opaque, already-namespaced keys per the task-002 contract).
- [x] `timeoutMs` expiry (fake timers) drops the entry, broadcasts `reason:"timeout"`, provider spy
      records zero responses — verified.
- [x] An untimed dialog survives a simulated day of idle — no daemon-side TTL — verified.
- [x] `sweep` cancels toward the entry's captured session, broadcasts the reason, unsubscribes before
      dropping the channel (a post-sweep emission does NOT resurrect a surface), and leaves
      `pending`/`surfaces`/`channels` empty — verified, including the zombie-emission case.
- [x] `attach` on an agent with pending entries sweeps them as `"aborted"` before subscribing the new
      session — verified, plus proof the new session is live afterward.
- [x] A session without `onUiRequest` attaches silently — verified.
- [x] No payload or response value appears in any captured log line — verified by asserting every
      logged object lacks a `payload`/`response` key AND never contains a planted secret string,
      across both the unknown-method `info` path and the `respondToUi`-throw `warn` path.

## Follow-ups / TODO(verify)

- RPC handler registration, the `AgentManager.onSessionAttached` hook, and both bootstraps wiring
  this service in are task-004 — nothing calls `attach()`/`respond()` yet outside tests.
- MCP mirror tools are task-005.
- Rate-limiting/coalescing `setStatus` bursts remains explicitly non-v1 per the scope (retention makes
  a future per-key trailing-edge coalescing lossless if this proves chatty in practice).
