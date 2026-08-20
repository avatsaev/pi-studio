# Task 004 — E2E: SDK + controller against a real daemon, real-Pi smoke, then docs sync

- **Sprint:** sprint-067-extension-ui-sdk
- **Status:** done
- **Type:** test + docs
- **Area:** packages/cli (E2E host), packages/server (one barrel export), docs
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** task-001, task-002, task-003

## Goal

Prove the SDK + controller work against a **real** daemon (real WS, real router, real
`AgentUiService`) rather than a scripted transport — including the answer round-trip, first-answer-wins
across two independent clients, and reconnect rehydration — then one real-`pi` smoke run, then sync the
docs.

## Context / why

Tasks 001-003 are all verified against `makeScriptedDaemon`, which is a fake this sprint authored. That
proves internal consistency, not interoperability: a field-name typo, a wrong RPC name, or a
misread response shape would pass every scripted test and fail against the real daemon. Sprint-066
took the same position from the other side — its `agent-ui-e2e.test.ts` runs real WS clients against a
real dev daemon with only the provider scripted.

**Where this test can legally live — verified, not assumed.** `packages/client` and `packages/server`
have **no dependency edge in either direction** (client → protocol, relay; server → protocol,
highlight, relay), so neither package can host a test that needs both. `packages/cli` is the **only**
package that already depends on both and already declares tsconfig project references to both
(`packages/cli/tsconfig.json` → protocol, client, server). Putting the test there costs **zero** new
dependency edges; adding a `server → client` devDependency instead would invert the documented build
layering for one test file. Root `vitest.config.ts` includes `packages/*/src/**/*.test.ts`, so a file
at `packages/cli/src/agent-ui-sdk-e2e.test.ts` is picked up by the normal suite with no config change.

**One prerequisite export.** `startDevDaemon` lives in `packages/server/src/daemon/dev-bootstrap.ts`
but the daemon barrel (`daemon/index.ts`) re-exports only `bootstrap.js`, and server's
`package.json` `exports` map allows the **root subpath only** — so the dev daemon is currently
unreachable from outside the package. This task adds the one missing line. The dev daemon is the right
harness here: it is mock-provider-only (this family's designated producer), in-memory, and registers
the `agent_ui_*` handlers in **both** bootstraps by sprint-066/task-004's design.

**What real Pi can and cannot prove — do not chase the impossible half.** Sprint-066/task-006
established live, with a real `pi --mode rpc`: dialogs work end to end (`rpiv-ask-user-question`
raises a real `select`, and selecting "Type something" opens a real follow-up `input`), and the turn
genuinely blocks until answered. But **retained surfaces are not observable via real Pi in this
version**: `rpiv-todo`'s widget and `pi-powerline-footer`'s footer use Pi's TUI-only
`ctx.ui.custom(...)`/factory `setWidget` forms, which never reach RPC mode as an
`extension_ui_request` at all — a confirmed Pi-core limitation, not a bridge bug. So surface
rehydration is proven against the **mock** provider, exactly as sprint-066 did, and the real-Pi run
covers the dialog path only.

## Scope references

- `swe/features/extension-ui-client-sdk.md` § Acceptance criteria, § Dependencies on other specs
- `swe/features/extension-ui-rpc.md` § Acceptance criteria (the server-side twin)
- `swe/sprints/sprint-066-extension-ui-rpc/done/task-006-e2e-real-pi-and-docs-summary.md` — the
  real-Pi findings this task builds on and must not re-litigate (TUI-only widgets; disconnect-survival
  already observed live)
- `packages/server/src/daemon/agent-ui-e2e.test.ts` — the harness pattern to mirror (random port,
  `startDevDaemon`, `silentLogger()`, per-test teardown)
- `packages/server/src/daemon/dev-bootstrap.ts` — `startDevDaemon` (line 63), `DevBootstrapHandle`
  (line 51); `handle.manager.get(agentId)?.session as MockAgentSession`
- `packages/server/src/agent/providers/mock/mock-provider.ts` — `MockAgentSession.emitUiRequest`
  (line 212) and the `uiResponses` recorder (line 72); already exported from the package root via
  `agent/index.ts`
- `packages/server/src/daemon/index.ts` — the barrel to extend
- `packages/client/src/transport.ts` — `createWebSocketTransport(factory?)` (line 55): pass a factory
  wrapping `ws`'s `WebSocket` rather than relying on a global
- `packages/cli/src/connection.ts` — `buildDaemonClient` (line 98) as the client-construction precedent
- `packages/client/AGENTS.md`, root `AGENTS.md` — docs to sync

## What to build

**1. Export the dev daemon (server).** Add `export * from "./dev-bootstrap.js";` to
`packages/server/src/daemon/index.ts`, beside the existing `bootstrap.js` line, with a one-line
comment saying why (test/dev harness reachable from `cli`'s E2E). Verified: no name collides with
`bootstrap.js`'s exports.

**2. E2E (cli).** Create `packages/cli/src/agent-ui-sdk-e2e.test.ts`. Per test: random free port,
`startDevDaemon({ host: "127.0.0.1", port, logger: silentLogger() })`, one or two real
`PiStudioClient`s over `createWebSocketTransport(() => new WebSocket(url))` (from `ws`), an agent
created over the wire, then drive the mock session's `emitUiRequest` and assert through the SDK.
Tear down daemon + clients in `afterEach`. Cover:

- **Answer round-trip.** `emitUiRequest({ method: "select" })` → controller state holds one pending
  entry → `controller.respond(id, { value: "a" })` → `{ ok: true }`, the entry disappears on the
  real `agent_ui_resolved`, and the mock session's `uiResponses` recorder shows the value reached the
  provider.
- **First-answer-wins across two clients.** Both see the dialog; A answers `{ ok: true }`; B's
  `respond` for the same id returns `{ ok: false, reason: "not_found" }` **without throwing**, and B's
  entry clears from the broadcast, not from its own call.
- **Rehydration from a real snapshot.** Emit a dialog **and** a `setStatus`/`setWidget` surface, then
  connect a **second, late** client and let its controller sync: it rebuilds both from
  `agent_ui_list_request` alone, with no live-frame replay.
- **Reconnect resync with no consumer call.** Close the transport under a live controller
  (pending → `answerable: false`), reconnect, and assert the controller re-syncs by itself and
  `answerable` returns to `true`.
- **Clear-by-omission.** A surface upsert then a `removed` clear leaves no surface, and a
  freshly-synced client sees none either.
- **Archive pruning — the highest-value scenario in this file.** Emit a dialog + a surface, archive
  the agent over the wire: the dialog clears via the real `agent_ui_resolved` broadcast, and the
  surface clears because the controller saw the real **`agent_archived`** session message
  (`bootstrap.ts`/`dev-bootstrap.ts` fan it out from the same `manager.subscribe` block that runs the
  server-side sweep) — the case with **no** server-side surface broadcast, which is the whole reason
  `agent_removed` exists. This is the one defect a scripted-transport test cannot catch: a controller
  mis-wired to `onAgentUpdate` passes every task-003 test that fakes the message, and fails only
  here, against a daemon that genuinely never emits `agent_update` on archive.
- **Capability gate.** `extensionUiAvailable()` is `true` against this daemon (guards against a
  feature-flag regression).

**3. Real-Pi smoke (dialog path only).** One manual run, recorded in the task summary with observed
output: real `pi --mode rpc` agent + `@juicesharp/rpiv-ask-user-question` installed, answer the real
`select` (and its `input` follow-up) **through `PiStudioClient.respondToUi`**, and observe the
extension's tool call complete. Use a disposable `PI_STUDIO_HOME`/`PI_STUDIO_PI_HOME` as
sprint-066/task-006 did. If the environment has no model credential, say so plainly in the summary
rather than fabricating a run.

**4. Docs.** `packages/client/AGENTS.md`: the new surface (five members, guards, `AgentUiError`, the
reducer/controller modules), the error-convention split and why, and — stated plainly — that
**nothing renders it yet**. Root `AGENTS.md`: extend the existing `agent_ui_*` protocol-overview
paragraph to note the client SDK now consumes it. Then update `swe/sprints/PLAN.md`'s coverage
paragraph for `features/extension-ui-client-sdk.md` from "planned" to shipped.

## Out of scope

- Any rendering, and any `packages/web-client` change whatsoever.
- Re-proving sprint-066's server-side criteria (its own suite owns those).
- Chasing a real-Pi **surface** observation — established impossible in this Pi version; use the mock.
- Standing up a live MCP endpoint for `respond_to_ui_request` (sprint-066/task-006 left that at a
  documented ceiling).
- Widening server's `exports` map, or adding any new cross-package dependency edge.

## Acceptance criteria

- [ ] `packages/server/src/daemon/index.ts` re-exports `dev-bootstrap.js`; `startDevDaemon` and
      `MockAgentSession` both import cleanly from `@av-pi-studio/server`'s **root** in `packages/cli`.
- [ ] All seven E2E scenarios above pass against a real dev daemon over a real WebSocket, with only
      the provider scripted.
- [ ] The answer round-trip asserts the value reached the **provider** (`uiResponses`), not merely
      that the RPC returned `ok`.
- [ ] The two-client test shows `{ ok: false, reason: "not_found" }` from the loser with **no** throw.
- [ ] The late-joining client's state is rebuilt from the snapshot alone (assert it received no
      `agent_ui_request` frame for the pre-existing dialog/surface).
- [ ] Reconnect resync happens with **no** consumer-initiated `resync()` call in the test body.
- [ ] Archive clears both halves against the real daemon, with the surface half attributable to
      `agent_removed` driven by a genuine `agent_archived` frame — not a synthesised one. Assert no
      `agent_update` frame was involved.
- [ ] Real-Pi smoke recorded in the summary with actual observed frames/output — or an explicit,
      reasoned statement of why it could not run.
- [ ] `packages/client/AGENTS.md` documents the surface and says nothing renders it yet; root
      `AGENTS.md` and `PLAN.md`'s coverage paragraph are updated.
- [ ] No new dependency edge in any `package.json`; no `tsconfig` reference added.
- [ ] Sprint gates green: `npm run build`, `npm run typecheck`, `npm run lint`, `npm test`.

## Test / verification plan

- Build: `npm run build` (full, dependency-ordered — this task touches two packages).
- Typecheck: `npm run typecheck`. If a signature changed earlier in the sprint, run `npm run clean`
  first — stale `.tsbuildinfo` silently hides errors on incremental runs.
- Lint/format: `npx oxlint` + `npx oxfmt --check` on changed files only (never a project-wide
  reformat).
- Tests: `npx vitest run packages/cli/src/agent-ui-sdk-e2e.test.ts` during development, then the full
  `npm test` as the sprint's closing gate.
- Manual: the real-Pi smoke run above, output pasted into the task summary.

## Notes

- Bind `127.0.0.1` and use a random high port per test, as `agent-ui-e2e.test.ts` does; never a fixed
  port (parallel vitest files would collide).
- Always `dispose()` controllers and close clients in `afterEach` — a leaked `onStateChange`
  subscription against a torn-down daemon is exactly the kind of cross-test bleed that makes a suite
  flaky under `npm test` but green per-file.
- The dev daemon is mock-only and in-memory: no `PI_STUDIO_HOME` is touched by the automated part.
  Only the real-Pi smoke needs a disposable home, and it must be removed afterwards.
- `emitUiRequest` fills sensible defaults for omitted fields; pass `expectsResponse: false` +
  `surfaceKey` explicitly for surface cases, or the default (`confirm`, `expectsResponse: true`)
  silently makes it a dialog.
