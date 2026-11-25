# Task 003 — The web client connects by pairing link through the relay only

- **Sprint:** sprints/sprint-146-close-the-door
- **Status:** done
- **Type:** feature
- **Area:** packages/workbench (browser host, connection UI), packages/web-client
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** none

## Goal
The browser build ("Pi Studio Lite") connects only through a pairing link with a relay offer. The
address and password form, the password in the URL and in browser storage are gone. Development
builds keep a direct connection to the same-origin `/daemon-ws` proxy. The desktop app is unchanged.

## Context / why
Owner decision 2026-11-24: Lite is relay-only, no opt-in switch for direct browser connections. With
task-001 the direct port refuses every browser anyway; this task makes the web client say so clearly
instead of failing, and removes the password from the page.

## Scope references
- `docs/daemon-audit-handoff.md` § Decisions → Web client as "Lite", § Milestones (M1)
- `packages/workbench/src/host/browser-connection.ts`, `browser-launch.ts`, `browser-host.ts`
- `packages/workbench/src/lib/connection/resolve-connect-target.ts`, `connection-store.ts`
- `packages/workbench/src/features/connection/ConnectionBar.tsx`, `connection-presentation.ts`
- `packages/workbench/src/stores/ui-store.ts` (`host`, `password`)
- `packages/web-client/vite.config.ts` (`/daemon-ws` proxy)
- `desktop/apps/pistudiodesktop/src/host/connection.ts` (falls back to `base.createTransport` when
  `kind` is undefined: confirm that path is not a direct browser dial the refusal would break)

## What to build
- Browser host connection: a target that is not `mode: "relay"` is refused with "Pi Studio Lite
  connects with a pairing link. Use the desktop app to connect to a daemon directly." A pairing link
  with only a `host` hint is refused the same way. The bearer subprotocol is no longer offered.
- `ConnectionBar` without a registry: one field for the pairing link, no password field.
- `ui-store`: drop `password`; on load, delete any stored password value.
- `browser-launch`: remove the `?host=&password=&cwd=&connect=1` grammar; keep `?pair=` and a page URL
  whose fragment carries `offer=`.
- Developer switch: when `import.meta.env.DEV`, the browser host also accepts a direct connection to
  the same-origin `/daemon-ws`. In `vite.config.ts` remove `changeOrigin`/`rewriteWsOrigin` so the
  daemon sees the page's real origin (the dev daemon allows the Vite origins, task-001).

## Out of scope
The Lite role and feature trimming (M8); Docker (task-005).

## Acceptance criteria
- [ ] Production build: typing an address shows the message above; a relay pairing link connects.
- [ ] No `password` key in `localStorage` after load; the launch tests cover the removed grammar.
- [ ] `npm run dev` web client connects to `npm run dev:daemon` with no extra setup.
- [ ] The desktop app (registry present) renders and connects as before: `npm run snapshot` or the
      real app on a local and a direct entry.

## Test / verification plan
- `npx vitest run packages/workbench/src/host packages/workbench/src/lib/connection packages/workbench/src/features/connection`
- `npm run build:workbench` (or the package's own build) and `npm run build:web-client`
- Desktop gate after the change: `cd desktop && cargo xtask ci`

## Notes
`workbench` and `web-client` `AGENTS.md`/`README.md` and the fern web UI page change in the same task.
