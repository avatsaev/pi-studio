# Task 004 — Attach choke point + `agent_ui_*` handlers + wiring in both bootstraps

- **Sprint:** sprint-066-extension-ui-rpc
- **Status:** done
- **Type:** feature
- **Area:** packages/server/src (agent + daemon wiring)
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-003

## Goal

Make the bridge live: give `AgentManager` a session-attach hook, register the two RPC handlers, and
wire the service into both the production and dev daemons so every spawn path attaches and
archive/delete sweeps.

## Context / why

`AgentUiService.attach()` exists after task-003 but nothing calls it. There are two session-creation
sites today (`agent-service.ts:89-96` in `spawnOrResumeSession`, and `:211` in `handleCreate`), and
threading a service dep into each is fragile — `spawnOrResumeSession` is a free function called from
`session-operations.ts` and the slash-command paths with their own deps objects, and a future import
path would silently skip attach.

**Both concerns already have a single choke point, so use it.** Every path funnels through
`AgentManager.attachSession()` (`agent-manager.ts:145`; called at `agent-service.ts:104` and `:228`),
and archive/delete already broadcast through `manager.subscribe()` — which **both** bootstraps
already consume for exactly this kind of fan-out (`bootstrap.ts:259-267`,
`dev-bootstrap.ts:93-99`). So the attach hook plus the existing subscriber cover every trigger the
service needs, with no per-call-site threading.

**This family is registered in the dev daemon too**, deviating from `provider-auth`/`file-watch`
(production-only). Deliberate: the mock provider is this family's designated producer, the dev daemon
is mock-only, and a UI family unexercisable there would be untestable exactly where a sibling UI
scope needs to develop against it. It follows `PermissionService`'s both-bootstraps precedent
(`bootstrap.ts:293-294`, `dev-bootstrap.ts:125-126`) — the other agent-scoped broadcast family.

## Scope references

- `swe/features/extension-ui-rpc.md` § New/changed files, § Behavior & algorithms (sweep triggers),
  § Dev daemon, § Error convention
- `packages/server/src/agent/agent-manager.ts` — `attachSession` (line 145), `subscribe` (line 112),
  `AgentManagerSubscriber`, `broadcastArchived` (line 216), `broadcastDeleted` (line 270)
- `packages/server/src/agent/agent-ui/agent-ui-service.ts` — from task-003
- `packages/server/src/files/file-watch-rpc.ts` — `registerFileWatchHandlers` as the `-rpc` module
  model, and its `{ ok: false, error }` payload convention
- `packages/server/src/ws/router.ts` — only `unknown_message_type` / `handler_error` exist and a
  handler cannot choose one, so domain failures ride the response payload
- `packages/server/src/daemon/bootstrap.ts` — `broadcast` (line 243), `getActiveSessions` (line 257),
  the `manager.subscribe` fan-out (lines 259-267), `PermissionService` (lines 293-294)
- `packages/server/src/daemon/dev-bootstrap.ts` — the same four anchors (lines 77, 91, 93-99, 125-126)

## What to build

**`packages/server/src/agent/agent-manager.ts`** — an optional attach hook:

- Add `onSessionAttached?: (agentId: string, session: AgentSession) => void` to the manager's deps.
- Call it at the end of `attachSession()` (line 145), after `managed.session = session`, guarded so a
  throwing hook can never break session attachment (log and continue).
- Keep it optional: existing constructions (tests, dev) that pass no hook behave exactly as today.

**`packages/server/src/agent/agent-ui/agent-ui-rpc.ts`** — `registerAgentUiHandlers(registry, deps)`
following `registerFileWatchHandlers`:

- `agent_ui_respond_request` → `service.respond(uiRequestId, response)`, returned as
  `{ type: "agent_ui_respond_response", payload: { ok, error? } }`.
- `agent_ui_list_request` → `{ type: "agent_ui_list_response", payload: { ok: true, pending,
  surfaces } }`, scoped by the optional `agentId`.
- Never `throw` for a domain failure — `not_found`/`unsupported` travel in `payload`.
- Do **not** stamp `requestId`; the router does it.

**`packages/server/src/daemon/bootstrap.ts`** and **`dev-bootstrap.ts`** (identically):

- Construct `new AgentUiService({ broadcast, getActiveSessions, logger })` — **no** `manager` dep
  (task-003 dropped it deliberately: `attach`/`respond`/`sweep` all act on the session captured per
  entry, never a manager lookup). Construct it, and its `broadcast`/`getActiveSessions` deps, before
  `AgentManager` so `onSessionAttached` below can close over it — this requires hoisting the
  existing broadcast-helper block above the manager construction in both bootstraps.
- Pass `onSessionAttached: (agentId, session) => agentUiService.attach(agentId, session)` into the
  `AgentManager` construction.
- Extend the **existing** `manager.subscribe(...)` fan-out to also call
  `agentUiService.sweep(event.agentId, "aborted")` on `agent_archived` / `agent_deleted`.
- `registerAgentUiHandlers(registry, { service: agentUiService })`.

## Out of scope

- MCP mirror tools (task-005) and the E2E/docs pass (task-006).
- Any cancel-on-interrupt or cancel-on-disconnect behavior — both are explicitly rejected by the
  scope; do not add a `SessionSubscriptions` entry for this family.
- Changing how `spawnOrResumeSession` or `handleCreate` construct sessions — the point of the hook is
  that they stay untouched.
- Buffering pre-attach UI events (sprint open question, owned by task-006's live run).

## Acceptance criteria

- [x] `AgentManager.attachSession` invokes `onSessionAttached` with the agent id and session; a hook
      that throws is logged and does **not** prevent the session from being attached.
- [x] A manager constructed **without** the hook behaves exactly as before (no new required dep).
- [x] `agent_ui_respond_request` for a live dialog returns `payload.ok === true` and the provider
      receives the answer; for a stale id it returns `{ ok: false, error: "not_found" }` **without**
      producing an `rpc_error` frame.
- [x] `agent_ui_list_request` returns pending dialogs and live surfaces; with `agentId` it is scoped
      to that agent, without it spans all agents.
- [x] Creating an agent through `create_agent_request` on the **dev daemon** (mock provider) and
      firing a scripted dialog broadcasts `agent_ui_request` to every connected session, and an
      answer over the socket resolves it — proving attach happens with no per-call-site threading.
- [x] The same flow works after a **forced respawn** (`resume_agent`): the new session attaches, the
      old pending entries were swept `"aborted"`, and stale ids answer `not_found`.
- [x] Archiving and deleting an agent each sweep its pending dialogs and surfaces (asserted via
      `agent_ui_list_request` returning empty and a `reason:"aborted"` broadcast).
- [x] Interrupting an agent leaves its pending dialogs and surfaces **intact** (the scope's explicit
      inverse rule).
- [x] A client that received `agent_ui_request` **disconnects**; the dialog stays pending and a
      second, still-connected client answers it successfully — explicitly asserting the divergence
      from `provider_auth`'s disconnect-cancels rule (this family registers no `SessionSubscriptions`
      entry, so there must be nothing to dispose on close).
- [x] `server_info.features.extensionUi` is advertised by a booted daemon.
- [x] Both `bootstrap.ts` and `dev-bootstrap.ts` register the family; the dev daemon can drive it
      end to end with the mock provider only.

## Test / verification plan

- Build: `npm run build:server` succeeds.
- Typecheck: `npm run typecheck` succeeds.
- Lint/format: `npx oxlint <changed files>` and `npx oxfmt --check <changed files>` clean.
- Tests: extend the manager test for the hook (invoked, optional, throw-isolated); add an
  `agent-ui-rpc` handler test for both handlers incl. the `not_found` payload path; add a
  daemon-level test over a real in-process WS session against the **mock** provider covering the
  broadcast → answer → resolve round-trip, the disconnect-survival case (two sessions, first one
  closed mid-dialog), the respawn sweep, archive/delete sweeps, and the interrupt-preserves case.
  Run `npx vitest run packages/server/src`; all pass.
- Manual check: `npm run dev:daemon`, create a mock agent, trigger a scripted dialog, observe
  `agent_ui_request` on the socket and resolve it with `agent_ui_respond_request`.

## Notes

- The hook is the whole point of this task: resist re-threading a service dep through
  `spawnOrResumeSession`'s callers. Any new spawn path added later inherits attach for free.
- Reuse the existing `manager.subscribe` block rather than adding a second subscriber — one fan-out
  site per bootstrap keeps the lifecycle wiring readable.
- Keep `registerAgentUiHandlers`' deps minimal (`{ service }`); `getActiveSessions` already lives in
  the service because pushes are provider-driven.
