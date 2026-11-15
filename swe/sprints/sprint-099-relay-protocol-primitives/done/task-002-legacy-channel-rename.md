# Task 002 — Move the shipped channel to `legacy-channel.ts` under `Legacy` names

- **Sprint:** sprint-099-relay-protocol-primitives
- **Status:** done
- **Type:** refactor
- **Area:** packages/relay, packages/server (relay transport + tests), packages/client (relay transport + tests)
- **Priority:** P1
- **Estimated size:** XS
- **Depends on:** task-001

## Goal
`channel.ts` and the names `createClientChannel` / `createDaemonChannel` are free for the protocol-2 channel, while the daemon and the SDK keep building and passing on the shipped channel until sprint-100 moves them over.

## Context / why
The feature keeps the public names `createClientChannel` and `createDaemonChannel` for the new channel (`relay-multi-client.md` § Public contract 1). The new channel takes a byte transport and speaks a different wire, so rewriting `channel.ts` in place would break `packages/server` and `packages/client` until both are rewritten. This task parks the shipped code under temporary names. Sprint-100/task-005 deletes it. Behaviour does not change.

## Scope references
- `swe/features/relay-multi-client.md` § Public contract 1, § 6 (Removed)
- Move: `packages/relay/src/channel.ts` → `packages/relay/src/legacy-channel.ts`, `channel.test.ts` → `legacy-channel.test.ts` (`git mv`)
- Modify: `packages/relay/src/index.ts`
- Import sites (found at planning): `packages/server/src/daemon/relay-transport.ts`, `packages/server/src/daemon/relay-transport.test.ts`, `packages/server/src/daemon/bootstrap.test.ts`, `packages/client/src/relay-transport.ts`, `packages/client/src/relay-transport.test.ts`

## What to build
- Rename every exported symbol of the moved file with a `Legacy` prefix: `createLegacyClientChannel`, `createLegacyDaemonChannel`, `LegacyTransport`, `LegacyEncryptedChannel`, `LegacyEncryptedChannelEvents`, `LegacyConnectionRole`, `LegacyRelaySessionAttachment` and the two options interfaces.
- Add a header comment: protocol 1, kept only until sprint-100/task-005 deletes it.
- Update the five import sites mechanically. No behaviour change, no other edits.
- `index.ts` exports `legacy-channel.js` in place of `channel.js`. task-003 adds the new `channel.js` export.

## Out of scope
- Any behaviour change, and the new channel (task-003).

## Acceptance criteria
- [ ] `git grep -n "createClientChannel\|createDaemonChannel"` outside `swe/` and `docs/` finds nothing in code: every caller uses the `Legacy` names.
- [ ] The relay, server and client builds pass, and their existing relay tests pass unchanged apart from the renames.

## Test / verification plan
- `npm run build:relay && npm run build:server && npm run build:client`
- `npx vitest run packages/relay/src packages/server/src/daemon/relay-transport.test.ts packages/server/src/daemon/bootstrap.test.ts packages/client/src/relay-transport.test.ts`
- `npx oxfmt <changed files>`

## Notes
- This is a temporary arrangement on the feature branch, not a compatibility path: nothing ships with `Legacy` names (sprint-100/task-005 removes them before the release).
- Package docs: no doc names the `Legacy` symbols. They describe the shipped channel, which stays true until sprint-101 rewrites them.
