# Task 003 — `AgentUiService`: wire-id minting, pending map, surface retention, first-wins resolution

- **Sprint:** sprint-066-extension-ui-rpc
- **Status:** done
- **Type:** feature
- **Area:** packages/server/src/agent/agent-ui
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** task-001, task-002

## Goal

Build the daemon service that correlates the provider UI channel: mints wire ids, tracks pending
dialogs, retains and clears surfaces, broadcasts to every client, resolves first-answer-wins, and
sweeps on session-terminal events.

## Context / why

This is the only stateful piece of the bridge, and it must stay **payload-blind** — every Pi-specific
decision was made in task-002. Four behaviors here are non-obvious and each one prevents a concrete
defect:

**Wire ids are daemon-minted, never the provider's.** `ProviderUiRequest.requestId` is
provider-scoped by contract: Pi emits UUIDs but only promises per-process uniqueness, and the mock
provider uses counters. Keying a daemon-global map by provider ids lets one agent's dialog shadow
another's and routes an answer into the wrong process. The service keeps
`wireId → { agentId, providerRequestId, session }` and providers never see a wire id.

**Interrupt touches nothing.** Dialogs are not turn-scoped — `pi-background-tasks` (a `core`-pack
member) raises questions outside any turn, and Pi's `interrupt` does not kill extensions — so
cancelling on interrupt would destroy unrelated background questions. Surfaces are agent-lifetime
state: wiping `rpiv-todo`'s widget because the user pressed Stop defeats the point of retaining it.
Sweeps run **only** on session-terminal events (archive/delete/re-attach).

**Expiry never answers.** Pi auto-resolves its own timed dialogs and its docs state the client need
not track timeouts (`rpc.md:1164`). A mirrored timer exists solely so clients dismiss in step;
sending a second response would target a dead id.

**Resolution broadcasts unconditionally.** If `respondToUi` throws (dead stdin after a crash), the
entry has already been removed — so a `try`/`finally` is what stops every *other* client from
keeping a ghost dialog that no longer appears in `agent_ui_list_response`.

## Scope references

- `swe/features/extension-ui-rpc.md` § Behavior & algorithms (the `AgentUiService` pseudocode is
  normative), § Data & persistence touchpoints, § Error handling & edge cases
- `packages/server/src/agent/permissions.ts` — `PermissionServiceDeps` (lines 66-70) and
  `PermissionService` (line 72) as the service-shape model
- `packages/server/src/agent/provider-contract.ts` — the two members added by task-002
- `packages/server/src/agent/agent-manager.ts` — read-only context: lifecycle triggers arrive from
  outside (task-004 wires bootstrap's existing `manager.subscribe` fan-out to `sweep`); the service
  itself takes **no** manager dependency
- `packages/server/src/ws/session.ts` — `Session` (the broadcast target type)

## What to build

Create `packages/server/src/agent/agent-ui/agent-ui-service.ts`.

```ts
export interface AgentUiServiceDeps {
  broadcast: (sessions: Iterable<Session>, message: unknown) => void;
  getActiveSessions: () => Iterable<Session>;
  logger?: Logger;
}
```

No `manager` dep — deliberately. `attach` receives the session directly, `respond`/`sweep` act on
the session **captured in each pending entry**, and lifecycle triggers are pushed in from the
bootstraps (task-004). A manager handle here would be dead weight that invites misuse (e.g. looking
up `managed.session`, which after a respawn is a *different* session than the one that issued a
pending id).

`getActiveSessions` sits in the **constructor** deps, unlike `PermissionServiceDeps` which receives
it at `registerHandlers` time — deliberate, because pushes here originate from provider events, not
from an RPC call, so there is no handler closure to capture it in.

State:

- `pending: Map<wireId, { agentId, providerRequestId, session, timer? }>`
- `surfaces: Map<agentId, Map<surfaceKey, AgentUiSurface>>`
- `channels: Map<agentId, Unsubscribe>`

Public surface:

- `attach(agentId, session)` — **sweep first** (`reason: "aborted"`), then, if `session.onUiRequest`
  exists, subscribe and store the unsubscribe in `channels`. The leading sweep is what stops a
  forced respawn (`spawnOrResumeSession` always spawns fresh) from leaving undead dialogs whose
  provider ids belong to a dead process.
- `respond(uiRequestId, response): { ok: boolean; error?: string }` — first-wins: unknown id ⇒
  `{ ok: false, error: "not_found" }`; session without `respondToUi` ⇒ `"unsupported"`; otherwise
  remove the entry, clear its timer, call `respondToUi(providerRequestId, response)` inside
  `try`/`finally`, and broadcast `agent_ui_resolved reason:"answered"` from the `finally`.
- `listPending(agentId?)` / `listSurfaces(agentId?)` — for the RPC and MCP read paths.
- `sweep(agentId, reason)` — for each pending entry: best-effort
  `entry.session.respondToUi(entry.providerRequestId, { cancelled: true })` — the **entry's captured
  session**, never a freshly attached one (on the attach-path sweep the new session never issued
  those ids), swallowing throws — and broadcast `agent_ui_resolved` with `reason`. Then drop the
  agent's pending entries and surfaces, and **call** the stored channel `Unsubscribe` before
  deleting it — merely deleting the map entry leaves the dying session's callback live, and one
  last UI event from a closing process would re-create surfaces for an archived agent.

Internal:

- `onProviderRequest(agentId, session, req)` — apply the surface effect (`req.removed` ⇒ delete the
  key, else upsert with `updatedAt`), mint `wireId = randomUUID()`, register in `pending` **only** if
  `req.expectsResponse`, arm a timer when `req.timeoutMs` is set, then broadcast `agent_ui_request`
  with the minted id, `agentId` and `createdAt`.
- `expire(wireId)` — drop from `pending`, broadcast `reason:"timeout"`, **never** call `respondToUi`.

Logging: `agentId` / wire `requestId` / `method` only — **never** the payload or the response. An
`input` dialog can carry a token an extension asked for. Log an unknown method once per method per
session at `info`, so a future blocking method is diagnosable rather than a silent hang.

## Out of scope

- RPC handler registration and bootstrap wiring (task-004) — this task exports a service only.
- The `AgentManager.onSessionAttached` hook itself (task-004); `attach()` is written here but nothing
  calls it yet.
- MCP tools (task-005).
- Any persistence: pending dialogs and surfaces are in-memory and die with the daemon, correctly —
  the Pi processes holding those dialogs die with it too.
- Rate-limiting/coalescing `setStatus` bursts — explicitly non-v1 in the scope.

## Acceptance criteria

- [x] A dialog request (`expectsResponse: true`) becomes exactly one pending entry and one broadcast
      `agent_ui_request` whose `requestId` is **not** the provider's id.
- [x] Two sessions emitting the **same** provider-scoped id yield two independent pending entries,
      each answerable without affecting the other, each delivering to its own session.
- [x] A fire-and-forget request is broadcast but never pending; answering it returns
      `{ ok: false, error: "not_found" }`.
- [x] `respond` forwards the answer verbatim to the owning session's `respondToUi` with that entry's
      **provider** id, and broadcasts `reason:"answered"`.
- [x] Two concurrent answers: first `{ ok: true }`, second `{ ok: false, error: "not_found" }`, and
      the provider spy received exactly **one** response.
- [x] A session lacking `respondToUi` yields `{ ok: false, error: "unsupported" }`.
- [x] A `respondToUi` that **throws** still returns `{ ok: true }` and still broadcasts
      `agent_ui_resolved` (the try/finally rule).
- [x] A surface request retains under its `surfaceKey`, last-value-wins; `listSurfaces` returns
      exactly one entry per key with the newest payload and `updatedAt`.
- [x] `removed: true` **deletes** the surface, still broadcasts, and the key is absent from
      `listSurfaces`.
- [x] `status:x` and `widget:x` coexist as two surfaces (the task-002 namespacing, verified end to end).
- [x] `timeoutMs` expiry (fake timers) drops the entry and broadcasts `reason:"timeout"` while the
      provider spy records **zero** responses.
- [x] An untimed dialog is still pending after a long simulated idle — no daemon-side TTL.
- [x] `sweep` cancels every pending entry toward **the entry's own captured session**, broadcasts
      the given reason, calls the stored channel `Unsubscribe` (a post-sweep emission from the old
      session must NOT re-create a surface), and leaves `pending`, `surfaces` and `channels` empty
      for that agent.
- [x] `attach` on an agent that already has pending entries sweeps them as `"aborted"` **before**
      subscribing the new session.
- [x] A session without `onUiRequest` attaches silently: no subscription, no error, no traffic.
- [x] No payload or response value appears in any captured log line.

## Test / verification plan

- Build: `npm run build:server` succeeds.
- Typecheck: `npm run typecheck` succeeds.
- Lint/format: `npx oxlint <changed files>` and `npx oxfmt --check <changed files>` clean.
- Tests: add `packages/server/src/agent/agent-ui/agent-ui-service.test.ts` using a **fake session**
  that implements only `onUiRequest`/`respondToUi` (no Pi, no child process, no network) and a spy
  `broadcast`. Use `vi.useFakeTimers()` for the expiry and no-TTL cases. Run
  `npx vitest run packages/server/src/agent/agent-ui`; all pass.

## Notes

- `randomUUID` from `node:crypto`, as everywhere else in this package.
- Keep the service free of any `method` string comparison beyond the unknown-method log — every
  semantic decision arrived pre-computed on `ProviderUiRequest`. A `switch (req.method)` here is the
  design going wrong.
- Broadcast, not per-session `send()`: an agent is a shared resource, any client may answer, and all
  must see the resolution. This family registers **no `SessionSubscriptions` entry** — a client
  disconnecting must **not** cancel a pending dialog (the deliberate inverse of `provider_auth`).
