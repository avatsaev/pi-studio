# Task 001 — Top-level envelopes + handshake schemas — Summary

- **Sprint:** sprint-002-protocol
- **Completed:** 2026-06-11
- **Status:** done

## What was implemented
Created `packages/protocol/src/messages.ts` with the top-level WebSocket envelope schemas and the
connection handshake, all Zod-validated and append-only:
- `helloSchema` — `{ type:"hello", clientId, clientType, protocolVersion, appVersion?, capabilities? }`
  with `clientType` enum (`mobile|browser|cli|mcp`).
- `serverInfoPayloadSchema` + `statusSchema` — `{ type:"status", payload:{ status:"server_info",
  serverId, hostname?, version?, capabilities, features } }`.
- `pingSchema` / `pongSchema` — `pong` carries `{ requestId, clientSentAt?, serverReceivedAt,
  serverSentAt }` (JSON liveness, not RFC6455 ping).
- `sessionEnvelopeSchema` — wraps a typed session message (refined to the full union in task-003).
- `topLevelEnvelopeSchema` — discriminated union keyed by `type`.
- `wireTimestampSchema` — `number | ISO-8601` so timestamp types never narrow across versions.

## Files created / changed
| File | Change |
|------|--------|
| `packages/protocol/src/messages.ts` | created |
| `packages/protocol/src/index.ts` | modified — re-exports messages |
| `packages/protocol/src/messages.envelopes.test.ts` | added — 10 tests |

## How it satisfies the scope
- **websocket-protocol.md § Connection & handshake / Top-level envelopes:** hello, status/server_info,
  ping/pong, session envelope, all reproduced with the documented field names; pong liveness modelled
  as a JSON envelope per the "not RFC6455 ping" note.
- **MAIN-SCOPE §9:** append-only — new fields optional, `wireTimestampSchema` is a non-narrowing
  union, `capabilities`/`features` are open `record` maps.

## Build & test results
```
$ npm run build:protocol      → exit 0 (no type errors)
$ npx vitest run packages/protocol/src/messages.envelopes.test.ts
 ✓ messages.envelopes.test.ts (10 tests)
 Test Files  1 passed (1)
      Tests  10 passed (10)
```

## Acceptance criteria
- [x] `hello` parses all four `clientType` values and rejects unknown ones.
- [x] `server_info` requires `serverId`, `capabilities`, `features` (each verified missing→fail).
- [x] `pong` schema includes `requestId` and server timestamps (and rejects when timestamps absent).
- [x] Top-level union discriminates on `type` and rejects unknown envelopes.

## Follow-ups / TODO(verify)
- `protocolVersion` typed as `number`; exact wire type unconfirmed against live `messages.ts`.
- `sessionEnvelopeSchema.message` is a structural passthrough until task-003 substitutes the real
  discriminated session-message union.
- Desktop `clientType` reuses `browser` per MAIN-SCOPE TODO(verify).
