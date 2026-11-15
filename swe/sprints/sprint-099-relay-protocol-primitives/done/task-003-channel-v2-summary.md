# Task 003 — Encrypted channel v2 — Summary

- **Sprint:** sprints/sprint-099-relay-protocol-primitives
- **Completed:** 2026-11-15
- **Status:** done

## What was implemented
`packages/relay/src/channel.ts`: protocol-2 channel (relay-protocol.md § 4). `createDaemonChannel({transport, daemonKeypair, events, randomBytes?, counterStart?, counterLimit?})`, `createClientChannel({transport, daemonPublicKey, events, keyPair?, counterStart?, counterLimit?})`; byte `Transport`; records 0x00 ready / 0x01 text / 0x02 binary; nonce = salt(15) ‖ direction ‖ big-endian counter (bigint, never sent); daemon salt per connection; encrypted `ready`; any failure → `onError` + close `4200 channel_error`, nothing delivered. Also exported for fixtures: `channelNonce`, `CHANNEL_VERSION`, `CHANNEL_SALT_LENGTH`, `RECORD_KIND`, `CHANNEL_DIRECTION`.

## Files created / changed
| File | Change |
|------|--------|
| `packages/relay/src/channel.ts` | created |
| `packages/relay/src/channel.test.ts` | created (20 tests) |
| `packages/relay/src/index.ts` | `channel.js` export added by orchestrator |
| `packages/relay/AGENTS.md`, `README.md` | channel rows documented by orchestrator |

## How it satisfies the scope
§ 4 and Behavior — Channel. Deviation: `counterStart`/`counterLimit` seams on both factories (needed to test wrap protection without 2^64 frames). A second `hello` needs no special case: it fails to open as a box → `channel_error`.

## Build & test results
```
$ npx vitest run packages/relay/src/channel.test.ts packages/relay/src/legacy-channel.test.ts -> 29 passed
$ wave gate: npm run build && npm run typecheck -> success; npm run lint -> no errors (pre-existing warnings); npm test -> 271 files, 3830 passed
```

## Acceptance criteria
- [x] text/binary both ways in order; byte layout + hand-opened nonce; distinct salts; modified/replayed/swapped/dropped/reflected boxes → 4200; wrong key → channel_error at ready; nothing before hello/ready; text frame / second hello / late ready / unknown kind → channel_error; 5 MiB text; counter limit closes — each covered by named tests in channel.test.ts

## Follow-ups / TODO(verify)
- Rust interop pinned later by task-006 fixtures.
