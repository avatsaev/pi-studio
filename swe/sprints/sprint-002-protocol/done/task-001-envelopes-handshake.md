# Task 001 — Top-level envelopes + handshake schemas

- **Sprint:** sprint-002-protocol
- **Status:** done
- **Estimated size:** S
- **Depends on:** task-003 (sprint-001)

## Goal
Define the Zod schemas for the top-level WebSocket envelopes and the connection handshake.

## Scope references
- `clean-room-scope/architecture/websocket-protocol.md` § Connection & handshake, § Top-level envelopes
- `clean-room-scope/MAIN-SCOPE.md` § 9 (Cross-Cutting Conventions)

## What to build
- Create `packages/protocol/src/messages.ts` (start) with envelope schemas:
  - `hello`: `{ type:"hello", clientId, clientType: "mobile"|"browser"|"cli"|"mcp", protocolVersion,
    appVersion?, capabilities?: {...} }`.
  - `status` / `server_info`: `{ type:"status", payload:{ status:"server_info", serverId, hostname?,
    version?, capabilities, features } }`.
  - `ping` / `pong`: `pong` carries `{ requestId, clientSentAt?, serverReceivedAt, serverSentAt }`.
  - `session`: envelope wrapping the session message union (union defined in task-003).
- Export a discriminated union of top-level envelopes keyed by `type`.

## Out of scope
- Capability flag constants (task-002), session message family (task-003), binary frames (task-004/005).

## Acceptance criteria
- [ ] `hello` parses all four `clientType` values and rejects unknown ones.
- [ ] `server_info` requires `serverId`, `capabilities`, `features`.
- [ ] `pong` schema includes `requestId` and server timestamps.
- [ ] Top-level union discriminates on `type` and rejects unknown envelopes per handler policy.

## Test / verification plan
- Tests: `npx vitest run packages/protocol/.../envelopes.test.ts` — round-trip + rejection cases.
- Build: `npm run build:protocol` succeeds.

## Notes
- `pong` liveness is the JSON envelope, NOT RFC6455 ping (browser/RN can't access protocol ping).
