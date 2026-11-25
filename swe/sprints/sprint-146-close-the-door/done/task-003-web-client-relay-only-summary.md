# Task 003 — The web client connects by pairing link through the relay only — Summary

- **Sprint:** sprints/sprint-146-close-the-door
- **Completed:** 2026-11-24
- **Status:** done

## What was implemented
In `browser-connection.ts` a relay pairing link gets the relay transport; every other target throws `LITE_REFUSAL` ("Pi Studio Lite connects with a pairing link. Use the desktop app to connect to a daemon directly."); the bearer subprotocol is gone. `createBrowserHost({ devDirect })` additionally accepts the page's same-origin `/daemon-ws`; `web-client/src/main.tsx` passes `import.meta.env.DEV` (workbench source may not read `import.meta.env`). Launch grammar keeps only `?pair=` and `#offer=`. `ConnectionBar` without a registry has one "Pairing link" field and no password field; `ui-store` lost `password`/`setPassword` and its default host is `""`. `vite.config.ts` no longer sets `changeOrigin`/`rewriteWsOrigin`. A legacy `password` localStorage key is removed on load.

## Files created / changed
| File | Change |
|------|--------|
| `packages/workbench/src/host/browser-connection.ts`, `browser-host.ts`, `browser-launch.ts` | relay-only transport, dev switch, launch grammar |
| `packages/workbench/src/host/browser-connection.test.ts` | added |
| `packages/workbench/src/host/launch.test.ts`, `hooks/use-connection.test.ts` | rewritten |
| `packages/workbench/src/hooks/use-connection.ts`, `stores/ui-store.ts`, `features/connection/ConnectionBar.tsx`/`.module.css` | no password, one field |
| `packages/web-client/src/main.tsx`, `vite.config.ts` | dev flag; proxy origin rewrite removed |
| workbench and web-client `AGENTS.md`/`README.md`, `fern/pages/web-ui.mdx` | documented |

## How it satisfies the scope
Handoff decision "web client as Lite, relay-only". `ConnectIntent.password` and `HostConnection.createTransport(target, { password })` stay in the host contract because the desktop host uses them. With no current registry entry, desktop's `base.createTransport` fallback now throws `LITE_REFUSAL` instead of dialing directly.

## Build & test results
```
$ npx vitest run packages/workbench/src            -> 150 files, 1982 passed
$ npm run build:workbench && npm run build:web-client -> success
$ npx tsc --noEmit -p desktop/apps/pistudiodesktop  -> clean
$ Wave gate (full tree, once, after tasks 001-005): `npm run build` exit 0; `npm run typecheck` exit 0; `npm run lint` exit 0 (existing warnings only); `npm test`: 329 of 330 files pass, 4727 of 4728 tests pass. The one failure, `packages/server/src/daemon/bootstrap.test.ts` > "extension packs RPC ... full round trip", fails identically on a pristine checkout of HEAD `a6efaa9a` (checked in a temporary worktree), so it is not caused by this sprint. `npm run fmt:check` reports 25 files; the 8 docs/compose files this sprint touched were already unformatted at HEAD.
```

## Acceptance criteria
- [x] Production build refuses non-pairing targets and uses the relay for a pairing link (unit tests only; browser check in task-006)
- [x] No `password` key in localStorage (legacy key removed on load; that removal has no test)
- [ ] `npm run dev` connects to `npm run dev:daemon` — not run here; checked in task-006
- [x] Desktop app type-checks; not run (`npm run snapshot`, `cargo xtask ci`)

## Follow-ups / TODO(verify)
- Desktop gate `cargo xtask ci` not run; the desktop snapshot not run.
