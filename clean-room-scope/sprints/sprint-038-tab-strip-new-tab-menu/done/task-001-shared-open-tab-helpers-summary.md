# Task 001 — Shared `openNewChat` helper alongside `openNewTerminal` — Summary

- **Sprint:** sprint-038-tab-strip-new-tab-menu
- **Completed:** 2026-07-23
- **Status:** done

## What was implemented
Added `openNewChat(workspaceCwd)` to `tab-store.ts`, right beside the existing `openNewTerminal`,
with the same contract: caller passes an already-normalized cwd; the helper creates a session
(`session-store.createSession`) and opens/focuses its chat tab (`tabIds.chat`, label `"New chat"`,
`closable: true`). Confirmed beforehand that `session-store.ts` has zero imports of `tab-store.ts`,
so `tab-store.ts` importing `session-store.ts` introduces no cycle.

Rewired the three existing "create session + open chat tab" call sites to use the shared helper
instead of inlining the sequence:
- `SessionList.tsx#handleNewSession` — now normalizes then calls `openNewChat(targetCwd)`; removed
  the now-dead `createSession` store binding (`openTab` binding is still used by `handleSelect`,
  kept).
- `open-workspace.ts#openWorkspace` — restructured into an explicit if/else: the "reuse existing
  session" branch is unchanged (still calls `activate` + inlines `open({...})` because it needs the
  *existing* session's real title, not always `"New chat"`); the "no existing session" branch now
  calls `openNewChat(cwd)`. The `activate(sessionId)` call after `createSession` in the old code was
  redundant for the create path — `session-store.createSession` already sets `activeSessionId`
  internally — so no activation behavior was lost.
- `use-session-restore.ts` — the "no restored sessions" bootstrap branch now calls
  `openNewChat(targetCwd)` instead of inlining `createSession` + `tabStore.open(...)`.

Verified `normalizeCwd` (`workspace-grouping.ts`) is idempotent (only rewrites a leading `~`), so
passing an already-normalized cwd into `createSession` (which stores it as `session.cwd`) is safe
and consistent with how `SessionList.tsx` already normalized before its own inline call.

## Files created / changed
| File | Change |
|------|--------|
| `packages/web-client/src/stores/tab-store.ts` | added `openNewChat` export + `session-store` import |
| `packages/web-client/src/features/sessions/SessionList.tsx` | `handleNewSession` delegates to `openNewChat`; removed dead `createSession` binding |
| `packages/web-client/src/features/sessions/open-workspace.ts` | create-new branch delegates to `openNewChat`; reuse branch unchanged |
| `packages/web-client/src/hooks/use-session-restore.ts` | no-sessions bootstrap branch delegates to `openNewChat` |

## How it satisfies the scope
Matches the task's "What to build" 1:1: helper signature, behavior, and all three specified
callsites migrated with no behavior change to the reuse/restore paths. No test file existed for
any of `tab-store.ts`/`session-store.ts`/`SessionList.tsx`/`open-workspace.ts`/
`use-session-restore.ts` prior to this task (confirmed via `vitest run packages/web-client`) so no
regression tests needed updating; none were added since this is a pure refactor with an unchanged
observable contract (task-002/003 don't call for new unit tests here either).

## Build & test results
```
$ npm run typecheck -w @av-pi-studio/web-client
> tsc -p tsconfig.json --noEmit
(no output — success)

$ npm run build:client   # unrelated pre-existing gap: @av-pi-studio/client had no dist/,
                          # breaking resolve-connect-target.test.ts before ANY change here; built
                          # once so the full suite is measurable.
> tsc -b packages/client
(no output — success)

$ npx vitest run packages/web-client
 Test Files  6 passed (6)
      Tests  39 passed (39)
```

## Acceptance criteria
- [x] `openNewChat(workspaceCwd)` exists in `tab-store.ts`, exported next to `openNewTerminal`.
- [x] `SessionList.tsx`, `open-workspace.ts`, and `use-session-restore.ts` all call the shared
      helper instead of inlining `createSession` + `open(...)`; no behavior change (same tab id,
      label `"New chat"`, `closable: true`, same `workspaceCwd`).
- [x] `open-workspace.ts` still activates the session for the reuse branch (explicit `activate`
      call kept); the create branch relies on `createSession`'s existing internal activation via
      `openNewChat` — verified by reading `session-store.ts#createSession`, which sets
      `activeSessionId: id` unconditionally.
- [x] `npm run typecheck -w @av-pi-studio/web-client` passes.

## Follow-ups / TODO(verify)
- None. The pre-existing `@av-pi-studio/client` unbuilt-dist gap (unrelated to this task) is noted
  above only so a future contributor isn't surprised by it; not something this task owns.
