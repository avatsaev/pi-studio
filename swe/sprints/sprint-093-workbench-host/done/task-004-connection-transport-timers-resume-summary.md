# Task 004 — Host: `connection` (transport factory, timers, resume signal) — Summary

- **Sprint:** sprints/sprint-093-workbench-host
- **Completed:** 2026-11-14
- **Status:** done

## What was implemented
Host gained `connection: { createTransport(target, {password}), timers, onResume(listener) }` with `ConnectTarget` now defined in `host/types.ts` (re-used by `resolve-connect-target.ts`). Browser implementation `host/browser-connection.ts`: today's three branches (relay transport / bearer-subprotocol socket / SDK default), worker timers, `visibilitychange`+`online`. `lib/connection/worker-timers.ts` (+test) moved to `host/browser-worker-timers.ts`; `resume-triggers.ts` became `lib/connection/resume-handler.ts` (`createResumeHandler()` — same decision/probe logic, no DOM). `connection-store.connect()` asks the host for the transport (a throw sets `error` and rejects) and passes `host.connection.timers` to `ReconnectionManager`. `WorkbenchBoot` subscribes to `onResume` once (effect cleanup unsubscribes). `web-client`'s `main.tsx` no longer attaches anything; the temporary `attachResumeTriggers` export is gone. Test host gained a scriptable `createTransport`, real timers, `emitResume()`.

## Files created / changed
| File | Change |
|------|--------|
| `packages/workbench/src/host/{types,browser-host}.ts` | connection member, ConnectTarget |
| `packages/workbench/src/host/browser-connection.ts` | created |
| `packages/workbench/src/host/browser-worker-timers{,.test}.ts` | moved from lib/connection/worker-timers* |
| `packages/workbench/src/host/connection.test.ts` | created (4 tests) |
| `packages/workbench/src/lib/connection/resume-handler.ts` | renamed from resume-triggers.ts, DOM wiring removed |
| `packages/workbench/src/lib/connection/{connection-store,resolve-connect-target,resume-action}.ts` | host transport/timers; type import; comment |
| `packages/workbench/src/shell/WorkbenchBoot.tsx` | resume subscription |
| `packages/workbench/src/index.ts, packages/web-client/src/main.tsx` | temporary export removed |
| `packages/workbench/src/test/test-host.ts` | connection scripting |
| `packages/{workbench,web-client,client}/AGENTS.md, docs/desktop-client-handoff.md` | docs |

## How it satisfies the scope
`workbench-host-adapter.md` § `connection.*` contracts and § Reconnect. The resume decision table, probe timeout and identity guard are unchanged (same code, now in `resume-handler.ts`).

## Build & test results
```
$ rg "new WebSocket|new Worker|visibilitychange|'online'" packages/workbench/src -g '!*.test.*'  (outside host/browser-*)
two comments only
$ npx vitest run packages/workbench/src/lib/connection packages/workbench/src/host -> 8 files / 51 tests passed
$ npm run build -> OK; typecheck -> OK; oxlint -> exit 0; oxfmt --check (43 changed files) -> clean
$ npx vitest run packages/workbench packages/web-client -> 113 files / 1478 tests passed

Browser (vite dev :5394, dev daemon :6790): connected; daemon stopped -> bar shows "connection failed";
daemon restarted -> reconnected automatically 9.6 s later (backoff ladder through the host's worker timers and transport).
```

## Acceptance criteria
- [x] No workbench source outside the browser host constructs a `WebSocket` or `Worker` or listens for `visibilitychange`/`online`.
- [x] Direct, password and relay connections behave as before (same three branches; direct + reconnect checked live; relay path covered by the unchanged resolve-connect-target tests).
- [x] A host-supplied transport is used by `DaemonClient` (unit test: the dialled URL goes through it).
- [x] A throwing `createTransport` produces the connection error (unit test).
- [x] Reconnect after a daemon restart works in the browser.
- [x] `docs/desktop-client-handoff.md`: the `connection` contract is documented as milestone 2's seam; the inventory table now has a status column.

## Follow-ups / TODO(verify)
- The relay transport path was not exercised live (no relay running locally); it is the same `createRelayTransport` call as before, moved verbatim.
