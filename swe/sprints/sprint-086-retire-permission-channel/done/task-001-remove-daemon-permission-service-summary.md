# Task 001 — Remove PermissionService and provider-contract permission members — Summary

- **Sprint:** sprints/sprint-086-retire-permission-channel
- **Completed:** 2026-11-13
- **Status:** done

## What was implemented
Deleted `agent/permissions.ts` (+test), dropped its export and both bootstrap registrations, removed `PendingPermission`/`getPendingPermissions`/`respondToPermission` from `AgentSession` and the Pi + mock providers, updated test stubs. Protocol schemas kept with a retired comment. Added a bootstrap test: `agent.permission.respond.request` and `respond_to_permission` yield `rpc_error unknown_message_type`.

## Files created / changed
| File | Change |
|------|--------|
| `packages/server/src/agent/permissions.ts`, `permissions.test.ts` | deleted |
| `agent/index.ts`, `provider-contract.ts`, `providers/{pi/agent,mock/mock-provider}.ts` | modified |
| `daemon/bootstrap.ts`, `daemon/dev-bootstrap.ts` | modified |
| 5 test stubs (compact-handler, session-ops, slash-command-ops, turn-settlement, agent-ui-rpc) | modified |
| `daemon/bootstrap.test.ts` | added retired-family test |
| `packages/protocol/src/messages.ts` | retired comment only |

## Build & test results
```
$ npm run clean && npx tsc -b --force   # success
$ npx vitest run packages/server packages/protocol   # 95 files, 1302 passed, 0 failed
$ npx oxfmt <changed>; npx oxlint <changed>   # clean
```

## Acceptance criteria
- [x] grep finds only MCP backend members (task-002 removes them)
- [x] retired request gets `unknown_message_type` (bootstrap.test.ts)
- [x] protocol permission round-trip tests pass unchanged

## Follow-ups / TODO(verify)
- none
