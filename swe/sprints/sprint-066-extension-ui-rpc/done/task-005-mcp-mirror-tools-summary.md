# Task 005 — MCP mirror: `list_pending_ui_requests` / `respond_to_ui_request` — Summary

- **Sprint:** sprint-066-extension-ui-rpc
- **Completed:** 2026-08-20
- **Status:** done

## Ground-truth correction (scope, found during implementation)

The task as written cited `bootstrap.ts:557-571` as "the `McpBackend` implementation object … where
the two new members are wired." That address is `ScheduleExecutor`, an unrelated interface — stale.
Investigating further: **`McpServer`/`McpBackend` (built in sprint-010/task-001) was never wired into
either bootstrap.** There is no `McpBackend` implementation object anywhere in `bootstrap.ts`/
`dev-bootstrap.ts`, no `daemon.mcp` config schema, and no `/mcp/agents` HTTP route mounted —
sprint-010's own summary flagged this explicitly as an unresumed follow-up ("HTTP transport for
`/mcp/agents` is a bootstrap step"), and nothing through sprint-065 picked it up. `McpServer` is
exercised only by `mcp-server.test.ts`'s hand-rolled fake backend.

Standing up the full HTTP transport + config schema + a real 13-member `McpBackend` bridging
`AgentManager`/`AgentService`/`PermissionService`/`ProviderRegistry` for the first time is that
abandoned sprint-010 task itself — M/L-sized, with its own acceptance criteria, not "pure surface
over task-003's existing methods" (this task's own stated non-goal). Doing it here would silently
absorb an unscoped, much larger deliverable under an XS ticket about two tools. **Task-005's own file
was corrected in place** (scope references, "what to build", "out of scope") to record this and drop
`bootstrap.ts`/`dev-bootstrap.ts` from its target files — the fix belongs to its own future task if
the daemon ever needs a live `/mcp/agents` endpoint.

## What was implemented

`McpBackend` (`mcp-server.ts`) gained `listPendingUiRequests(agentId?)` and
`respondToUiRequest(requestId, response)`, mirroring the permission pair's shape exactly.
`registerCoreTools()` registers `list_pending_ui_requests` and `respond_to_ui_request` immediately
after the permission tools, using the family's own error vocabulary
(`unknown_ui_request`/`unsupported`) rather than the WS side's `not_found` or the permission tool's
`unknown_permission` — each surface keeps its own convention, per the task's explicit instruction not
to "align" them. The tool handler never collapses `unsupported` into `unknown_ui_request`: doing so
would report a still-answerable-over-WS dialog as gone.

Since there is no real backend to attach to, the mapping logic itself — the delegation a future
bootstrap-wiring task must paste into the real `McpBackend` object — was written once as a small
`backendOver(service: AgentUiService)` helper in the test file and proven directly against a live
`AgentUiService` instance (not just a hand-rolled fake), covering every acceptance criterion:
resolve + broadcast, stale id, fire-and-forget id, unsupported provider, and an MCP-vs-WS race.

## Files created / changed

| File | Change |
|------|--------|
| `packages/server/src/agent/mcp-server.ts` | added the two `McpBackend` members + two tool registrations |
| `packages/server/src/agent/mcp-server.test.ts` | fake backend gained matching implementations; added 3 fake-backend tests + 4 tests against a real `AgentUiService` (7 new tests total) |
| `swe/sprints/sprint-066-extension-ui-rpc/*/task-005-mcp-mirror-tools.md` | corrected scope references, "what to build", and "out of scope" to the ground truth above |

## How it satisfies the scope

Implements `swe/features/extension-ui-rpc.md` § MCP mirror at the layer that actually exists today
(`mcp-server.ts`'s tool registry). Closes the documented deadlock's tool-surface half — an
orchestrating agent that *does* have a wired `McpBackend` (once one exists) can list and answer a
child's pending dialogs with zero further work on `mcp-server.ts`'s side. No CLI mirror, no surface
(`setStatus`/`setWidget`) exposure, no new `AgentUiService` capability — task-003's `listPending`/
`respond` are the only service methods touched, exactly as scoped.

## Build & test results

```
$ npx tsc --noEmit -p packages/server          # incremental checks during implementation
(clean throughout)

$ npx vitest run packages/server/src/agent/mcp-server.test.ts
Test Files  1 passed (1)
     Tests  16 passed (16)   # 9 pre-existing + 7 new

$ npx oxfmt --check packages/server/src/agent/mcp-server.ts packages/server/src/agent/mcp-server.test.ts
clean (2 files needed a scoped `npx oxfmt <files>` fix, then verified clean)

$ npx oxlint packages/server/src/agent/mcp-server.ts packages/server/src/agent/mcp-server.test.ts
clean (2 new closures were flagged consistent-function-scoping and hoisted to module scope
before the final pass — zero warnings remain)

$ npm run clean && npm run typecheck      # forced full rebuild
tsc -b
(success, zero errors)

$ npm run build                           # full monorepo build
(success)

$ npm run lint                            # full monorepo lint
exit 0, 0 errors

$ npm test                                # full monorepo suite
Test Files  171 passed (171)
     Tests  2170 passed (2170)
```

## Acceptance criteria

- [x] `list_pending_ui_requests` returns the same pending set as `agent_ui_list_request`, honoring
      the optional `agentId` filter — verified against a real `AgentUiService`.
- [x] `respond_to_ui_request` resolves a live dialog exactly as the WS RPC does — provider receives
      one response, `agent_ui_resolved` broadcasts — verified.
- [x] Stale/unknown id → `{ ok: false, error: "unknown_ui_request" }` — verified.
- [x] Fire-and-forget request (never pending) → same `unknown_ui_request` failure — verified.
- [x] Provider without `respondToUi` → `{ ok: false, error: "unsupported" }`, not
      `unknown_ui_request` — verified.
- [x] MCP-vs-WS race: exactly one reaches the provider, the loser reports its own surface's
      not-found style error (`unknown_ui_request` on MCP's side) — verified.
- [x] Tools absent/inert when MCP server is disabled — inherited automatically: both tools register
      inside the same `if (deps.enabled)`-gated `registerCoreTools()` block as every other tool, and
      the pre-existing "MCP disabled" test already asserts `toolNames()` is empty and calls report
      `mcp_disabled` for the whole registry.

## Follow-ups / TODO(verify)

- **`McpServer`/`McpBackend` still has no live HTTP endpoint or real backend implementation
  anywhere in the daemon** — a pre-existing gap from sprint-010, unchanged and unenlarged by this
  task. If a future task resumes it, `backendOver()` in `mcp-server.test.ts` is the exact literal to
  paste into the real `McpBackend` object for these two members.
- Task-006 (real-Pi E2E + docs sync) remains, closing out the sprint.
