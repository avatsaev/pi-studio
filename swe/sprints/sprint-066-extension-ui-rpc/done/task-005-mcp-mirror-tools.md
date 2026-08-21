# Task 005 — MCP mirror: `list_pending_ui_requests` / `respond_to_ui_request`

- **Sprint:** sprint-066-extension-ui-rpc
- **Status:** done
- **Type:** feature
- **Area:** packages/server/src/agent (MCP surface)
- **Priority:** P2
- **Estimated size:** XS
- **Depends on:** task-004

## Goal

Expose the two read/answer operations as MCP tools so an orchestrating agent can list and answer a
child agent's pending dialogs.

## Context / why

Beyond symmetry with the permission tools, this closes a real deadlock: a parent agent spawns a child
(`features/subagents.md`), the child's extension raises a questionnaire, and with no MCP path the
parent cannot answer it — the child blocks until a human notices. The daemon already mirrors its
permission family this way (`mcp-server.ts:247-260`), so the shape is settled.

**Error vocabulary intentionally differs from the WS side.** WS returns `not_found`; this returns
`unknown_ui_request`, matching its neighbour `respond_to_permission`'s `unknown_permission`
(`mcp-server.ts:258`). Each surface follows its own established convention rather than inventing a
third one — do not "align" them.

## Scope references

- `swe/features/extension-ui-rpc.md` § MCP mirror
- `swe/features/mcp-server.md`, `swe/features/subagents.md` (the deadlock this closes)
- `packages/server/src/agent/mcp-server.ts` — `McpBackend` (line 42), the permission bridge members
  (lines 62-65), their tool registrations (lines 247-260)
- `packages/server/src/agent/agent-ui/agent-ui-service.ts` — `listPending` / `respond` from task-003

**Ground-truth correction (found during implementation):** sprint-010/task-001 built `McpServer`/
`McpBackend` but its own summary explicitly deferred wiring it up: *"HTTP transport for
`/mcp/agents` is a bootstrap step"* — a follow-up nothing through sprint-065 ever picked up. There is
**no `McpBackend` implementation object anywhere in `bootstrap.ts`/`dev-bootstrap.ts`**, no
`daemon.mcp` config schema, and no `/mcp/agents` HTTP route mounted — `McpServer` is exercised only
by `mcp-server.test.ts`'s fake backend. The `createAgent`/`promptExisting` literal this task
originally cited at `bootstrap.ts:557-571` is `ScheduleExecutor`, an unrelated interface — stale
citation, not the `McpBackend`. Standing up the full HTTP transport + a real 13-member `McpBackend`
bridging `AgentManager`/`AgentService`/`PermissionService`/`ProviderRegistry` for the first time is
the abandoned sprint-010 follow-up itself — an M/L-sized, separately-scoped undertaking with its own
config schema and acceptance criteria, not "pure surface over task-003's existing methods." Doing it
here would silently absorb that whole deferred task under an XS ticket about two tools.
**Scope is corrected accordingly**: build the two-method surface and prove its request/response
mapping against the real `AgentUiService` (not a fake), but stop at `mcp-server.ts` — do not invent
bootstrap wiring that was never scoped to this sprint. `bootstrap.ts`/`dev-bootstrap.ts` are removed
from this task's target files.

## What to build

**`packages/server/src/agent/mcp-server.ts`**:

- Add to `McpBackend`:
  ```ts
  listPendingUiRequests(agentId?: string): AgentUiPendingRequest[];
  respondToUiRequest(requestId: string, response: AgentUiResponse): { resolved: boolean; error?: string };
  ```
- Register the two tools beside the permission pair, following their exact shape:
  - `list_pending_ui_requests`, params `{ agentId?: string }` → `{ ok: true, requests }`
  - `respond_to_ui_request`, params `{ requestId: string, response: <object> }` →
    `{ ok: true }` \| `{ ok: false, error: "unknown_ui_request" }` \|
    `{ ok: false, error: "unsupported" }`

**Tests (`mcp-server.test.ts`)** — beyond the fake-backend pair every other tool gets, add one test
that implements the two `McpBackend` members for real against a live `AgentUiService` instance
(`{ resolved: result.ok, error: result.error }`, mapping `AgentUiService.respond`'s `"not_found"` to
the tool's `"unknown_ui_request"`), so the mapping logic itself — not just a hand-rolled fake — is
proven, including the MCP-vs-WS race. **This literal is exactly what a future bootstrap-wiring task
must drop into the real `McpBackend` object**, so it is written once, tested, and ready to paste in.

`requestId` here is the **daemon-minted wire id**, identical to the WS surface — the provider-scoped
id is never exposed.

## Out of scope

- Any new service capability: this task is pure surface over task-003's existing methods.
- **Wiring `McpServer` into `bootstrap.ts`/`dev-bootstrap.ts`** (HTTP transport, `daemon.mcp` config,
  the full 13-member backend) — pre-existing gap from sprint-010, not created or enlarged by this
  task, and out of this sprint's scope; belongs to its own future task if/when picked up.
- A CLI mirror (`pi-studio ui …`) — out of scope for the whole sprint.
- Exposing surfaces (`setStatus`/`setWidget` state) over MCP: an orchestrating agent answers
  questions; it has no use for a status line, and adding it would widen the tool surface for nothing.

## Acceptance criteria

- [x] `list_pending_ui_requests` returns the same pending set as `agent_ui_list_request`, honoring
      the optional `agentId` filter.
- [x] `respond_to_ui_request` resolves a live dialog exactly as the WS RPC does — the provider
      receives one response and `agent_ui_resolved` is broadcast to WS clients.
- [x] A stale/unknown id returns `{ ok: false, error: "unknown_ui_request" }`.
- [x] Answering a fire-and-forget request (never pending) returns the same
      `unknown_ui_request` failure.
- [x] A dialog owned by a provider without `respondToUi` returns
      `{ ok: false, error: "unsupported" }`, **not** `unknown_ui_request`.
- [x] An answer delivered over MCP and one delivered over WS race correctly: exactly one reaches the
      provider, the loser reports its surface's not-found error.
- [x] Tools are absent/inert when the MCP server is disabled, like every other tool there.

## Test / verification plan

- Build: `npm run build:server` succeeds.
- Typecheck: `npm run typecheck` succeeds.
- Lint/format: `npx oxlint <changed files>` and `npx oxfmt --check <changed files>` clean.
- Tests: extend the MCP server test with both tools (happy path, unknown id, fire-and-forget id) and
  add the MCP-vs-WS race assertion against the service. Run
  `npx vitest run packages/server/src/agent`; all pass.

## Notes

- Keep `response` typed as an object passed through to the service — the permissiveness rule from
  task-001 applies identically here; do not validate per-method shapes.
- The tool name is `respond_to_ui_request` (singular "request"), matching the wire family's noun and
  the `respond_to_permission` precedent.
