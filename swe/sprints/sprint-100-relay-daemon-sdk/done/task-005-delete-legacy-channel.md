# Task 005 — Delete the protocol-1 channel

- **Sprint:** sprint-100-relay-daemon-sdk
- **Status:** done
- **Type:** chore
- **Area:** packages/relay
- **Priority:** P1
- **Estimated size:** XS
- **Depends on:** task-003, task-004

## Goal
No protocol-1 code is left: `legacy-channel.ts`, its test and its export are gone.

## Context / why
Hard cut (D3): relay and clients speak only protocol 2, with no compatibility path. sprint-099/task-002 parked the shipped channel under `Legacy` names only so the daemon and SDK could move over one at a time. Both have moved.

## Scope references
- `swe/features/relay-multi-client.md` § 6 (Removed: `e2ee_*` JSON frames), D3
- Delete: `packages/relay/src/legacy-channel.ts`, `packages/relay/src/legacy-channel.test.ts`
- Modify: `packages/relay/src/index.ts`

## What to build
- Delete both files and the export.
- Check that the base64 helpers (`base64.ts`) and `deriveRelaySessionId` are still exported. They stay public (feature spec § Public contract 1); `packages/cli/src/pairing.ts` uses `decodeBase64`.

## Out of scope
- Rewriting relay docs (sprint-101/task-002).

## Acceptance criteria
- [ ] `git grep -n "Legacy\|e2ee_app\|e2ee_bin\|e2ee_hello\|e2ee_ready" packages/*/src` finds nothing.
- [ ] Relay, server, client and cli build; their tests pass.

## Test / verification plan
- `npm run build:relay && npm run build:server && npm run build:client && npm run build:cli`
- `npx vitest run packages/relay/src packages/server/src/daemon packages/client/src`
