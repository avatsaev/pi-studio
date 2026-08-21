# Task 004 — Attach choke point + `agent_ui_*` handlers + wiring in both bootstraps — Summary

- **Sprint:** sprint-066-extension-ui-rpc
- **Completed:** 2026-08-20
- **Status:** done

## What was implemented

Made the bridge live. `AgentManager` gained an optional `onSessionAttached?(agentId, session)` hook
in `AgentManagerDeps`, invoked at the end of `attachSession()` after `managed.session = session`,
wrapped in `try`/`catch` so a throwing hook is logged (`agentId` + error message, via a new optional
`logger?: Logger` dep) and never prevents attachment. Both are optional — existing constructions with
neither behave exactly as before.

`registerAgentUiHandlers(registry, { service, logger })` (`agent-ui-rpc.ts`) wires
`agent_ui_respond_request`/`agent_ui_list_request` onto `AgentUiService`, following
`registerFileWatchHandlers`/`registerProviderAuthHandlers`: never throws for a domain failure
(`not_found`/`unsupported` travel in `payload`), never stamps `requestId` (the router does).

Both `bootstrap.ts` and `dev-bootstrap.ts` wire identically: `AgentUiService` is constructed with
**no `manager` dep** (task-003's deliberate design — corrected a stale line in this task's own
"What to build" section that still said otherwise, a leftover from before task-003's F4 review fix)
*before* `AgentManager`, since `onSessionAttached` needs to close over it — this required hoisting
each bootstrap's existing `broadcast`/`sessionsHolder`/`getActiveSessions` block (verified
dependency-free) above the manager construction. The existing `manager.subscribe(...)` archive/
delete fan-out gained one line — `agentUiService.sweep(event.agentId, "aborted")` — rather than a
second subscriber. `registerAgentUiHandlers` is called in both, after `PermissionService`, following
its both-bootstraps precedent (this family, like permissions, is agent-scoped broadcast the mock
provider must be able to produce in dev).

`DevBootstrapHandle` gained a test-only `manager: AgentManager` field — there is no WS RPC that lets
a test script a `MockAgentSession.emitUiRequest()` call (by design: a real Pi process is what would
normally emit these), so reaching the live session to drive the daemon-level test needed this one
escape hatch.

## Files created / changed

| File | Change |
|------|--------|
| `packages/server/src/agent/agent-manager.ts` | added `onSessionAttached?`/`logger?` to `AgentManagerDeps`; `attachSession` invokes the hook, guarded |
| `packages/server/src/agent/agent-manager.test.ts` | added a 4-test `describe("onSessionAttached hook …")` suite |
| `packages/server/src/agent/agent-ui/agent-ui-rpc.ts` | new — `registerAgentUiHandlers` |
| `packages/server/src/agent/agent-ui/agent-ui-rpc.test.ts` | new — 3 tests driving the real router (live-dialog resolve, stale-id `not_found` without an `rpc_error` frame, `agent_ui_list_request` scoping) |
| `packages/server/src/daemon/bootstrap.ts` | hoisted broadcast helper above manager; constructed `AgentUiService`; wired `onSessionAttached` + sweep-on-archive/delete; registered handlers |
| `packages/server/src/daemon/dev-bootstrap.ts` | same wiring; added `manager` to `DevBootstrapHandle` |
| `packages/server/src/daemon/agent-ui-e2e.test.ts` | new — 7 tests over a real dev daemon + real WS sessions (feature flag, round-trip, disconnect-survival, respawn sweep, archive sweep, delete sweep, interrupt-preserves) |

## How it satisfies the scope

Implements `swe/features/extension-ui-rpc.md` § New/changed files (`agent-manager.ts`'s hook,
`agent-ui-rpc.ts`, both bootstraps) and § Behavior & algorithms' sweep triggers. `spawnOrResumeSession`
and `handleCreate` were not touched — the whole point of the choke-point hook, verified by the
respawn-sweep E2E test actually exercising `resume_agent`'s real code path with zero threading
changes to `session-operations.ts`. No `SessionSubscriptions` entry was added for this family (the
disconnect-survival E2E test proves there is nothing to dispose on close). MCP tools and the E2E/docs
pass are correctly deferred to tasks 005/006.

## Build & test results

```
$ npx tsc --noEmit -p packages/server     # incremental checks during implementation
(clean on every incremental check; no bugs from this task's own new code — task-003's earlier
 session-type confusion was already caught and fixed in that task, not here)

$ npx vitest run packages/server/src/agent/agent-manager.test.ts packages/server/src/agent/agent-ui packages/server/src/daemon/agent-ui-e2e.test.ts
Test Files  4 passed (4)
     Tests  39 passed (39)

$ npx oxfmt --check <changed files>
clean (2 files needed a scoped `npx oxfmt <files>` fix, then verified clean)

$ npx oxlint <changed files>
2 pre-existing warnings only (`dev-bootstrap.ts`'s `broadcast` and `bootstrap.ts`'s
`lastAssistantText`, both `consistent-function-scoping`, verified via `git stash` diff to predate
this task — their line numbers shifted from the broadcast-block hoist, content did not); this
task's own two new closures (`agent-manager.test.ts`'s `fakeSession`, `agent-ui-rpc.test.ts`'s
`broadcast`) were flagged the same way and hoisted to module scope before the final pass, so they
introduce zero new warnings

$ npm run build:server
tsc -b packages/server
(success)

$ npm run clean && npm run typecheck      # forced full rebuild
tsc -b
(success, zero errors)

$ npm run build                           # full monorepo build
(success)

$ npm run lint                            # full monorepo lint
exit 0, 0 errors

$ npm test                                # full monorepo suite
Test Files  171 passed (171)
     Tests  2163 passed (2163)
```

## Acceptance criteria

- [x] `attachSession` invokes the hook with agent id + session; a throwing hook is logged and never
      blocks attachment — verified (both the direct unit test and, transitively, every E2E test that
      creates an agent).
- [x] A manager without the hook behaves exactly as before — verified.
- [x] `agent_ui_respond_request`: live dialog → `payload.ok===true` + provider receives the answer;
      stale id → `not_found` without an `rpc_error` frame — verified at both the handler layer
      (`agent-ui-rpc.test.ts`) and end to end (`agent-ui-e2e.test.ts`'s respawn test's stale-id case).
- [x] `agent_ui_list_request` scoping (with/without `agentId`) — verified.
- [x] Dev-daemon round-trip proving attach with no per-call-site threading — verified via a real
      `create_agent_request` → `emitUiRequest` → WS broadcast → `agent_ui_respond_request` → resolve
      cycle over a real dev daemon.
- [x] Forced-respawn sweep: new session attaches, old pending entries swept `"aborted"`, stale ids
      `not_found` — verified via a real `resume_agent` call.
- [x] Archive/delete sweeps — verified via real `archive_agent`/`delete_agent` calls, each asserting
      an empty `agent_ui_list_request` and a `reason:"aborted"` broadcast.
- [x] Interrupt preserves pending dialogs and surfaces — verified via a real `interrupt_agent` call.
- [x] Disconnect-survival — verified: two real WS clients, first closes mid-dialog, second answers
      successfully.
- [x] `server_info.features.extensionUi` advertised on boot — verified against a real dev daemon's
      `status` frame.
- [x] Both bootstraps register the family; the dev daemon drives it end to end with mock only —
      verified (all seven E2E tests run exclusively against `startDevDaemon`).

## Follow-ups / TODO(verify)

- MCP mirror tools (task-005) and the real-Pi E2E + docs sync pass (task-006) remain.
- The manual check step (`npm run dev:daemon`, trigger a scripted dialog by hand) was not run
  interactively — `agent-ui-e2e.test.ts` exercises the identical code path (`startDevDaemon` + a real
  WS client + `create_agent_request` + `emitUiRequest` + `agent_ui_respond_request`) programmatically
  and is stronger evidence than an unrecorded manual session; flagging per the contract's
  evidence-must-match-claim rule rather than asserting the manual step was performed.
- `DevBootstrapHandle.manager` is a test-only escape hatch (documented as such in its own doc
  comment) — not part of the RPC surface, not something a real client should ever reach for.
