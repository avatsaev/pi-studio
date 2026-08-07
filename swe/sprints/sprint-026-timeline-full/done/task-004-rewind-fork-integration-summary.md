# Task 004 — Rewind & fork-context integration — Summary

- **Sprint:** sprint-026-timeline-full
- **Completed:** 2026-07-06
- **Status:** done

## What was implemented

Wired the rewind menu and fork-context menu to daemon RPCs, with capability
gating, destructive confirmation, and post-rewind timeline truncation +
composer restore.

1. **Rewind RPC (`timeline/rewind.ts`).** `buildRewindRequest(agentId,
   messageId, mode)` shapes the `agent.rewind.request` payload; `REWIND_RPC`
   constant. Capability gating reuses the existing `rewindMenuItems` /
   `shouldShowRewindMenu` (independent per-mode flags; empty → menu hidden).

2. **Destructive confirmation (`buildRewindConfirmation`).** `conversation`
   mode → no destructive confirmation. `files`/`both` → a required destructive
   confirmation whose message lists the affected files ("2 files will be
   reverted…", or a generic clause when the list is unavailable), with a
   "Revert" confirm label and a mode-specific title.

3. **Post-rewind sync (`hooks/use-rewind.ts` → `useRewind`).** On success:
   `mode !== "files"` truncates the timeline via the new store action, then
   `postRewindActions` drives `refetch-tail` (re-fetch the tail page) and
   `restore-composer` (insert the rewound message text when the composer is
   empty). `pendingMode` gives the per-row spinner; the menu stays open on error
   for retry (the caller surfaces a toast).

4. **Timeline truncation (`store/session-store.ts`).**
   `truncateTimelineAfter(agentId, messageId)` drops all rows at/after the row
   matching `rowId` **or** payload `messageId`; no-op when not found.

5. **Fork context (`timeline/fork.ts` + `useFork`).** `buildForkRequest` builds
   a `create_agent_request` payload carrying a `forkFrom { agentId, messageId }`
   marker (omitting undefined provider/cwd); `canFork` gates the affordance to
   assistant messages. `useFork(sourceAgentId).fork(...)` creates the session
   and returns the new `agentId` for the caller to navigate to.

## Files created / changed

| File | Change |
|------|--------|
| `packages/app/src/timeline/rewind.ts` | modified (RPC payload + confirmation) |
| `packages/app/src/timeline/rewind.test.ts` | modified (+4 tests) |
| `packages/app/src/timeline/fork.ts` | created |
| `packages/app/src/timeline/fork.test.ts` | created (3 tests) |
| `packages/app/src/hooks/use-rewind.ts` | created (`useRewind` + `useFork`) |
| `packages/app/src/store/session-store.ts` | modified (`truncateTimelineAfter`) |
| `packages/app/src/store/session-store.test.ts` | modified (+2 truncation tests) |
| `packages/app/src/timeline/index.ts` | modified (export fork) |
| `packages/app/src/hooks/index.ts` | modified (export rewind/fork hooks) |

## How it satisfies the scope

- **rewind.md § Wire contract** — `agent.rewind.request` with
  `{ agentId, messageId, mode }`; on success (`mode !== "files"`) the client
  truncates the timeline and re-fetches the tail (`onRefetchTail`).
- **rewind.md § Rewind menu** — items derived from provider capability flags;
  hidden when none supported; selected mode locks with a spinner (`pendingMode`).
- **§ Post-rewind client state sync** — `postRewindActions` → refetch-tail +
  restore-composer (only when composer empty and text present).
- **task-004 § Confirmation with file revert warning** — `files`/`both` show a
  destructive confirmation listing affected file paths.
- **task-004 § Fork-context menu** — `create_agent` with `forkFrom`; returns the
  new agentId for navigation; gated to assistant messages.

### Deviations / boundaries
- **Affected-file enumeration** for the destructive confirmation depends on a
  daemon-provided checkpoint diff; `buildRewindConfirmation` accepts the list
  and degrades to a generic clause when unavailable (daemon mechanism is
  provider/workspace-specific per the scope's TODO(verify)).
- **`forkFrom` daemon handling** and navigation target (new workspace route) are
  the daemon/router's responsibility; `useFork` returns the new agentId and the
  caller navigates (the router already maps agentId→workspace in dev).
- Hooks are thin wrappers over the tested pure builders; not render-tested
  (node-only env). The RPC call paths use `client.connection.request` /
  `client.createAgent`.

## Build & test results

```
$ npx tsc -b packages/app
(clean)

$ npx vitest run packages/app/src/timeline/rewind.test.ts \
    packages/app/src/timeline/fork.test.ts \
    packages/app/src/store/session-store.test.ts
 Test Files  3 passed (3)
      Tests  48 passed (48)

$ npm run build && npm run typecheck   # whole monorepo
(clean)

$ npm test
 Test Files  127 passed (127)
      Tests  1608 passed (1608)
```

## Acceptance criteria
- [x] Rewind menu only visible when capability advertised; correct modes shown —
      `rewindMenuItems`/`shouldShowRewindMenu` (existing tests) + `useRewind`.
- [x] Confirming conversation rewind: RPC → timeline truncated → draft restored —
      `buildRewindRequest` + `truncateTimelineAfter` (`session-store.test.ts`) +
      `postRewindActions`.
- [x] Files/both rewind shows destructive confirmation with file list —
      `buildRewindConfirmation` (`rewind.test.ts`).
- [x] Fork-context creates a new session and navigates — `buildForkRequest`
      (`fork.test.ts`) + `useFork` returning the new agentId.

## Follow-ups / TODO(verify)
- Daemon checkpoint diff to populate the affected-files list.
- `create_agent` `forkFrom` daemon support + concrete new-workspace navigation.
- Toast surfacing on rewind failure at the menu call site.
