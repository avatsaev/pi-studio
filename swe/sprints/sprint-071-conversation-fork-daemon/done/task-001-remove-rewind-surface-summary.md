# Task 001 — Remove the dead rewind surface — Summary

- **Sprint:** sprint-071-conversation-fork-daemon
- **Completed:** 2026-08-26
- **Status:** done

## What was implemented

Deleted the unwired `agent.rewind.request` RPC handler and its only caller-side primitive, and
stopped the daemon falsely advertising `rewind` as a supported feature.

## Files created / changed

| File | Change |
|------|--------|
| `packages/server/src/agent/rewind-rpc.ts` | deleted |
| `packages/server/src/agent/rewind-rpc.test.ts` | deleted |
| `packages/server/src/agent/timeline-store.ts` | removed `truncateBeforeMessage` |
| `packages/protocol/src/client-capabilities.ts` | removed `rewind` from `SERVER_FEATURES` + `SERVER_FEATURE_COMPAT` |
| `packages/protocol/src/client-capabilities.test.ts` | dropped `"rewind"` from expected key list; rewrote 3 `supports()` sample-key assertions to use `providersSnapshot` |

## How it satisfies the scope

Matches `swe/features/conversation-fork.md` § Relationship to the rewind RPC exactly: the handler,
its test, and `truncateBeforeMessage` (its only caller) are gone; `agent.rewind.*` schemas
(`messages.ts`) and `supportsRewindConversation/Files/Both` (`provider-manifest.ts`) were left
untouched — both are append-only wire surfaces per the spec's explicit "keep" list, and grepping
confirms them still present and unreferenced by any deleted code.

## Build & test results

```
$ npm run build:protocol && npm run build:server
success (tsc -b, no errors)

$ npx vitest run packages/protocol packages/server/src/agent
Test Files  36 passed (36)
     Tests  481 passed (481)
```

## Acceptance criteria

- [x] `server_info.features` no longer contains `rewind` (verified: not in `SERVER_FEATURES`, which
      both bootstraps derive their advertised flags from via `Object.values(SERVER_FEATURES)`).
- [x] `rewind-rpc.ts`, `rewind-rpc.test.ts`, `truncateBeforeMessage` no longer exist anywhere in the
      repo (grep for `registerRewindHandler|rewind-rpc|truncateBeforeMessage|RewindDeps` across
      `packages/` returns zero code hits — only a stale doc line in `packages/server/AGENTS.md`,
      left for task-004's docs pass).
- [x] `agent.rewind.*` schemas and `supportsRewind*` manifest flags are still exported and unchanged.
- [x] No remaining references to the deleted symbols (build is clean; no dead imports).

## Follow-ups / TODO(verify)

- `packages/server/AGENTS.md`'s source-layout row still lists `rewind-rpc.ts` — deferred to
  task-004 (sprint close docs pass) per this sprint's task split.
