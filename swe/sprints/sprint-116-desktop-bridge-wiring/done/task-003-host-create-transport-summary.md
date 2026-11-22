# Task 003 — Desktop host: `createTransport` picks the proxy for local and direct entries — Summary

- **Sprint:** sprint-116-desktop-bridge-wiring
- **Completed:** 2026-11-22
- **Status:** done

## What was built
`createDesktopConnection(base, ipc, daemons, log)` in `src/host/connection.ts` now takes the `Ipc` and `Pick<HostDaemons, "snapshot">` and reads the kind of the current entry from the registry snapshot: `local` or `direct` returns `createProxiedTransport`; `relay`, no current entry, or an id not in the list returns the browser host's transport. `options.password` is never read for a proxied entry. `desktop-host.ts` builds `daemons` before `connection`. Outside Tauri `main.tsx` still uses the plain browser host. `connection.ts` relies on the page reloading on a switch (it does) so `createTransport` never sees a stale current entry.

## Files changed
`desktop/apps/pistudiodesktop/src/host/connection.ts`, `desktop-host.ts`, `connection.test.ts`; docs `desktop/AGENTS.md`, `desktop/README.md`, `desktop/docs/architecture.md` (the lines that said the host does not call `transport_open`).

## Commands run
- In the app: `npm run check`, `npm run lint`, `npm test` (129 passed in 19 files); `npm run build` then `npm run snapshot` drew the page headless with no Content-Security-Policy failure.

## Wave gate (orchestrator, combined tree)
- `cargo xtask ci` in `desktop/`: all 8 steps passed. In `desktop/apps/pistudiodesktop`: `npm run check` ok, `npm run lint` clean, `npm test` 129 passed. No file under `packages/` changed in this wave, so the root npm gates were not re-run (last: 4,133 passed).

## Acceptance criteria
- [x] With fakes: a direct and a local entry get the proxied transport (`createTransport` not called, `transport_open {url}` sent); a relay entry, also with a direct host hint, gets the browser host's.
- [x] A password passed for a proxied entry is sent to no command (the test serialises every `invoke` call).
- [x] `npm run check`, `lint`, `test` pass; `npm run snapshot` draws the page with no policy violation.
- [ ] **The container live check (one open transport in `ui.inspect`, one client in the daemon's status): handed to 116/task-005 run (1), which makes the same check.** This task had an undeclared dependency on task-002 (`ui.inspect`'s transports) for it; the code was not waiting on it, so the task ran in parallel and the check moves to task-005.

## Follow-ups
- `oxfmt` ignores `desktop/` (`.oxfmtrc.json`), so these files are formatted by hand; lint passes.
