# Task 001 — Relay control protocol module: frames, close codes, limits

- **Sprint:** sprint-099-relay-protocol-primitives
- **Status:** done
- **Type:** feature
- **Area:** packages/relay
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** none

## Goal
One pure module in `@av-pi-studio/relay` holds the protocol-2 control vocabulary, so the relay server, the daemon and the SDK share it without copying strings or numbers.

## Context / why
Protocol 2 has six control frames, eleven close codes and ten limits and timers. The relay server (task-004), the daemon (sprint-100) and the SDK (sprint-100) all use them. Without a shared module each package would carry its own copy and they would drift. The module is browser-safe: no `ws`, no `node:*` imports.

## Scope references
- `swe/architecture/relay-protocol.md` § 1 (control frames), § 2 (limits and timers), § 3 (close codes)
- `swe/features/relay-multi-client.md` § Decisions (D10, D17, S4, S10)
- Create: `packages/relay/src/control.ts`, `packages/relay/src/control.test.ts`
- Modify: `packages/relay/src/index.ts` (export the module)
- Pattern to follow: `packages/relay/src/session-id.ts` (small pure module, own test)

## What to build
- **Frame types** for `relay_daemon_register { v: 2, sessionId }`, `relay_registered`, `relay_client_connect { v: 2, sessionId }`, `relay_dial { connectionId }`, `relay_daemon_attach { v: 2, sessionId, connectionId }`, `relay_paired { connectionId }`.
- `encodeControlFrame(frame): string` for the JSON text frame.
- `parseFirstFrame(data: string): FirstFrame` → the three socket-opening frames (`daemon_register` | `client_connect` | `daemon_attach`), `{ kind: "legacy", sessionId }` for a `{ type: "relay_register" }` frame, or `{ kind: "invalid" }` for anything else: not JSON, not an object, wrong `v`, a malformed `sessionId` or `connectionId`, or an unknown type.
- `parseRelayFrame(data: string)` for the frames a daemon or client receives (`relay_registered`, `relay_dial`, `relay_paired`). It returns `null` for an unknown type, which the receiver ignores.
- Validators: `sessionId` and `connectionId` are each 32 lowercase hexadecimal characters.
- `RELAY_CLOSE`: code and reason name for 4100–4109 and 4200, as in § 3.
- `isForwardableCloseCode(code)`: true for 1000–1003, 1007–1014 and 3000–4999.
- `RELAY_DEFAULTS`: clients per daemon 32, frame size 100 MiB, identify 10 s, attach 10 s, registration answer 10 s, key exchange 10 s, connect 15 s, ping 30 s, silence 90 s, backoff 1 s → 30 s with ±20 % jitter, replaced-wait 30 s, flow-control high 1 MiB / low 256 KiB.
- `newConnectionId(randomBytes?)`: 128 random bits as hex. It uses `tweetnacl`'s `randomBytes` by default so the module stays browser-safe.

Package docs: `packages/relay/AGENTS.md` and `README.md` are shared by every task in this sprint. Run alone, document the module in the source-layout tree and the API table. In a parallel wave, do not edit them: put the exact edits in the summary and the orchestrator applies them.

## Out of scope
- Using the module anywhere: task-004 (relay server), sprint-100 (daemon, SDK).
- The encrypted channel (task-003).

## Acceptance criteria
- [ ] Each frame of § 1 round-trips through `encodeControlFrame` and its parser with exactly the fields of the table.
- [ ] `parseFirstFrame` returns `invalid` for non-JSON, an array, `v: 1`, a missing `v`, a 31-character or uppercase `sessionId`, and an unknown `type`. It returns `legacy` for `{ "type": "relay_register", "sessionId": "<anything>" }`.
- [ ] `RELAY_CLOSE` matches § 3 code for code and name for name, and no code is 4000.
- [ ] `isForwardableCloseCode` is false for 1004, 1005, 1006, 1015 and 2999, and true for 1000, 1008, 3000 and 4000.
- [ ] `RELAY_DEFAULTS` values equal § 2.
- [ ] `index.ts` exports the module; the package stays importable in a browser (no Node-only import).

## Test / verification plan
- `npx vitest run packages/relay/src/control.test.ts`
- `npm run build:relay`
- `npx oxfmt <changed files>`

## Notes
- The fixtures (task-006) pin these frames and codes for the Rust client. Keep the constant names readable: the fixture test compares against them.
- `parseFirstFrame` must not throw on any input. The relay calls it on untrusted data.
