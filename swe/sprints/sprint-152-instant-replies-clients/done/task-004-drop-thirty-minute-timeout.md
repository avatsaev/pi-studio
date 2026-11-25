# Task 004 — Workbench: the 30-minute request timeout goes

- **Sprint:** sprints/sprint-152-instant-replies-clients
- **Status:** done
- **Type:** refactor
- **Area:** packages/workbench (connection), packages/client (per-call timeouts)
- **Priority:** P2
- **Estimated size:** S
- **Depends on:** task-003

## Goal
The workbench uses the SDK's normal request timeout, and every request that can really take longer
names its own.

## Context / why
`connection-store.ts` sets `rpcTimeoutMs` to 30 minutes for the whole connection, only because create
and send used to block for a turn. Every other request inherited it, so a daemon that stopped
answering was reported after half an hour. Some requests do need more than the SDK's 30 s, and today
they lean on the big value without saying so.

## Scope references
- `packages/workbench/src/lib/connection/connection-store.ts` (:117-120)
- `packages/client/src/daemon-client.ts` (`rpcTimeoutMs` :122, `request(type, params, timeoutMs?)`),
  `pistudio-client.ts` (`COMPACT_TIMEOUT_MS` and the skills timeouts as the model)
- `packages/client/AGENTS.md` (:378-379), `swe/features/desktop-client-protocol-followups-2.md` (:64)

## What to build
- `connection-store.ts` passes no long timeout (the SDK default applies).
- List every request the workbench or the CLI sends that can legitimately exceed 30 s (candidates:
  provider login flows, extension packs set, daemon update apply, git clone or worktree creation,
  session import and resume, interrupt of a slow turn; skills and compact already have their own) and
  give each a named constant in the SDK beside `COMPACT_TIMEOUT_MS`, used by its facade method.
- A table-driven test pins method → timeout. Docs: the client and workbench `AGENTS.md`.

## Out of scope
Binary file transfers (not bounded by the request timeout).

## Acceptance criteria
- [ ] No 30-minute value is left in the workbench.
- [ ] Each long request has a named timeout and a test; a provider login that takes two minutes does
      not time out (fake timers).
- [ ] A request to a daemon that never answers fails after the default, and the socket stays up.

## Test / verification plan
- `npx vitest run packages/client packages/workbench`
- `npm run build:client && npm run build:workbench`
