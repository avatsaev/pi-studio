# Task 004 — Host: `connection` (transport factory, timers, resume signal)

- **Sprint:** sprint-093-workbench-host
- **Status:** done
- **Type:** feature
- **Area:** packages/workbench (host, connection)
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-001

## Goal
Let the host create the transport, supply the reconnect timers and signal when a stale connection should be checked.

## Context / why
This is the seam a Rust-owned socket plugs into. The SDK already accepts an injected `Transport` and injected timers; only the application's own wiring is browser-specific today.

## Scope references
- `swe/architecture/workbench-host-adapter.md` § Member contracts (`connection.*`), § Browser host
- `swe/features/connection-resilience.md`
- `packages/workbench/src/lib/connection/{connection-store.ts,worker-timers.ts,resume-triggers.ts,resume-action.ts,resolve-connect-target.ts}`
- `packages/client/src/{transport.ts,reconnect.ts}` (contracts, unchanged)
- `packages/web-client/src/main.tsx` (`attachResumeTriggers()` call)
- `docs/desktop-client-handoff.md` § What to build in Rust, step 1

## What to build
- Add `connection.createTransport(target, { password })`, `connection.timers` and `connection.onResume(listener)` to the host type.
- Browser host: `createTransport` is today's branch from `connection-store` (relay transport for a pairing link, a bearer-subprotocol socket when a password is set, otherwise `undefined`); `timers` are the worker timers with their fallback; `onResume` subscribes to `visibilitychange` (hidden to visible only) and `online`.
- `connection-store.connect()` asks the host for the transport and passes `host.connection.timers` to `ReconnectionManager`.
- `WorkbenchBoot` subscribes to `onResume` once and runs the existing `resolveResumeAction` logic. Delete the temporary `attachResumeTriggers` export and its call in `web-client`.
- Tests: the store uses the transport the host returns; a throwing factory surfaces as the connection error; a resume signal with a stale socket takes the existing probe or reconnect path; unsubscribing on unmount.
- Keep `docs/desktop-client-handoff.md` current: update whatever this task makes stale there (status table, workbench and host sections, wire facts, milestones, open questions). Say in the summary what changed in it, or that nothing did.

## Out of scope
- Changing reconnect policy or the resume decision table.
- Any change in `packages/client`.

## Acceptance criteria
- [ ] No workbench source outside the browser host constructs a `WebSocket`, a `Worker` for timers, or listens to `visibilitychange`/`online`.
- [ ] `web-client` connects directly, with a password, and through a pairing link exactly as before.
- [ ] Backgrounding the tab for several minutes and returning still reconnects promptly.
- [ ] `main.tsx` no longer imports anything but the stylesheets, the host factory and `Workbench`.
- [ ] Existing connection-resilience tests pass.
- [ ] `docs/desktop-client-handoff.md` matches the repository after this task, or the summary states that nothing in it was affected.

## Test / verification plan
- `npx vitest run packages/workbench/src/lib/connection packages/workbench/src/host`
- Browser check: connect, stop the daemon, start it again, confirm automatic reconnect; repeat over a pairing link if a relay is available.

## Notes
- The handoff document tells the desktop agent that `Transport` must deliver frames in wire order with binary as `ArrayBuffer`. Repeat that rule in the host type's documentation comment: it is the contract a foreign transport is most likely to break.
