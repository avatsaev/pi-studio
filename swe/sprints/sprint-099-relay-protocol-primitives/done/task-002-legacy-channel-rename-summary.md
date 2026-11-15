# Task 002 — Shipped channel moved to `legacy-channel.ts` — Summary

- **Sprint:** sprints/sprint-099-relay-protocol-primitives
- **Completed:** 2026-11-15
- **Status:** done

## What was implemented
`channel.ts`/`channel.test.ts` `git mv`'d to `legacy-channel.*`; every export got a `Legacy` prefix (`createLegacyClientChannel`, `createLegacyDaemonChannel`, `LegacyTransport`, `LegacyEncryptedChannel`, …); protocol-1 header comment. No behaviour change.

## Files created / changed
| File | Change |
|------|--------|
| `packages/relay/src/legacy-channel.ts`, `legacy-channel.test.ts` | moved + renamed |
| `packages/relay/src/index.ts` | exports `legacy-channel.js` |
| `packages/relay/src/relay-server.test.ts`, `session-bridge.test.ts` | imports updated (not listed in task; needed to compile) |
| `packages/server/src/daemon/relay-transport.ts`, `relay-transport.test.ts`, `bootstrap.test.ts` | renamed imports |
| `packages/client/src/relay-transport.ts`, `relay-transport.test.ts`, `pairing.ts` | renamed imports / comment |

## How it satisfies the scope
Temporary parking; s100/t005 deletes it. Deviation: two extra relay test files and a doc comment updated.

## Build & test results
```
$ npm run build:relay && npm run build:server && npm run build:client   -> success
$ npx vitest run packages/relay/src packages/server/src/daemon/relay-transport.test.ts packages/server/src/daemon/bootstrap.test.ts packages/client/src/relay-transport.test.ts -> 11 files, 112 passed
$ npx oxfmt on changed files
```

## Acceptance criteria
- [x] `git grep createClientChannel|createDaemonChannel` finds nothing in code
- [x] builds + existing relay tests pass

## Follow-ups / TODO(verify)
- Pre-existing oxlint `prefer-add-event-listener` warnings in client/relay-transport.ts (file is rewritten in s100/t004).
