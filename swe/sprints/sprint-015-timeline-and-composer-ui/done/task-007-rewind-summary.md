# Task 007 — Rewind (conversation & file time-travel) — Summary

- **Sprint:** sprint-015-timeline-and-composer-ui
- **Completed:** 2026-07-05
- **Status:** done

## Files created / changed

| File | Change |
|------|--------|
| `packages/protocol/src/provider-manifest.ts` | Added `supportsRewindConversation/Files/Both?` to `agentCapabilityFlagsSchema` (optional, passthrough, append-only) |
| `packages/protocol/src/messages.ts` | Added `rewindModeSchema`, `agentRewindRequestSchema`, `agentRewindResponseSchema`; added both to `sessionMessageSchema` union |
| `packages/server/src/agent/timeline-store.ts` | Added `truncateBeforeMessage(messageId)` to `AgentTimelineStore` |
| `packages/server/src/agent/rewind-rpc.ts` | Rewind RPC handler: conversation truncation + file revert + response |
| `packages/server/src/agent/rewind-rpc.test.ts` | 6 server tests |
| `packages/app/src/timeline/rewind.ts` | Client rewind menu items (capability-gated), mutation state machine, post-rewind sync actions |
| `packages/app/src/timeline/rewind.test.ts` | 10 client tests |

## Tests

```
npx vitest run packages/server/src/agent/rewind-rpc.test.ts  → 6 passed
npx vitest run packages/app/src/timeline/rewind.test.ts      → 10 passed
npx vitest run                                                → 929 passed (83 files)
```

## Acceptance criteria

- [x] Capability-gated menu: shows only the modes the agent advertises; empty → render nothing.
- [x] `agent.rewind.request` with `mode:"conversation"` truncates the daemon timeline; client resyncs.
- [x] `mode:"files"` calls `revertFilesSince` without touching conversation history.
- [x] `mode:"both"` does both.
- [x] Composer is only auto-filled when empty (`composerEmpty=true`).
- [x] Error state surfaces toast error; menu stays usable for retry (not closed on error).
- [x] Old capability-flag consumers unaffected (new flags are optional + `.passthrough()`).

## TODO(verify)

- Exact checkpoint strategy for non-git workspaces is TODO(verify); the `revertFilesSince` dep is injected, not hardcoded to git.
