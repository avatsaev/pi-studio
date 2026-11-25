# Task 004 — Terminal subscriptions end with their session

- **Sprint:** sprints/sprint-154-socket-limits
- **Status:** backlog
- **Type:** bugfix
- **Area:** packages/server (terminal RPC)
- **Priority:** P2
- **Estimated size:** S
- **Depends on:** task-003

## Goal
When a client disconnects, the daemon stops sending it terminal output and forgets its subscriptions.

## Context / why
Finding F4 (first bullet), folded into M5 by the owner. `terminal-rpc.ts` keeps `streamUnsubs` keyed
by session and slot, and nothing removes the entries when the session closes: `disposeSession` in
`bootstrap.ts` covers subscriptions, status, logs and file transfer, but not terminals. Each flush then
sends to a closed socket, and the map grows.

## Scope references
- `docs/daemon-audit-handoff.md` § F4
- `packages/server/src/terminal/terminal-rpc.ts` (:26-28, :114-115), `terminal-manager.ts` (`onExit`
  near :384)
- `packages/server/src/ws/session-subscriptions.ts` (the model: file watch and git status use it)
- `packages/server/src/daemon/bootstrap.ts` (`disposeSession` :793-799), `dev-bootstrap.ts` (near :504)

## What to build
Terminal stream subscriptions are disposed when their session closes, in both daemons, and their
entries are removed on unsubscribe and when the terminal exits. Prefer the existing
`SessionSubscriptions` over a second mechanism.

## Out of scope
Output backpressure (task-003). Binary-safe terminal output.

## Acceptance criteria
- [ ] Subscribe, then close the session: the terminal has no subscriber for it and the map is empty.
- [ ] A terminal that exits clears its entries for every session.
- [ ] The same in the dev daemon.

## Test / verification plan
- `npx vitest run packages/server/src/terminal packages/server/src/daemon`
- `npm run build:server`
