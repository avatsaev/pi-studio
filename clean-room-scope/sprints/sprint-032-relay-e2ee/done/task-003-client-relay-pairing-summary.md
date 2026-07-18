# Task 003 — Client relay transport + pairing (QR fragment) — Summary

- **Sprint:** sprint-032-relay-e2ee
- **Completed:** 2026-07-18
- **Status:** done

## What was implemented

### `packages/client/src/relay-transport.ts`
`createRelayTransport({ sessionId, daemonPublicKey, factory? })` returns a `Transport` — the exact
same interface `createWebSocketTransport` implements (`./transport.js`) — so `DaemonClient` (or
anything built on it) uses relay and direct connections completely interchangeably. `connect(url)`
dials the relay's own WebSocket address, sends `{ type: "relay_register", sessionId }` (matching
task-002's daemon-side registration frame), generates a FRESH ephemeral Curve25519 keypair via
`createClientChannel` (`@av-pi-studio/relay`, task-001), and resolves the returned promise **only
once `e2ee_ready` arrives** — meaning `DaemonClient.connect()`'s subsequent `hello` send is already
happening over an established, authenticated encrypted channel; no app RPC can reach the relay
plaintext.
- `sendText` re-encrypts through the channel; throws if called before the handshake completes
  (mirrors the daemon side's identical gating from task-001/002).
- `sendBinary` throws — the relay E2EE channel wire format (architecture/relay-e2ee.md § Behavior)
  only specifies text-frame app messages; binary-over-relay is out of scope here (documented as a
  deliberate limitation, not a stub).
- Exported `AnyWebSocket`/`WsFactory`/`reasonString` from `transport.ts` (previously module-private)
  for reuse, rather than duplicating the browser/Node `ws` compatibility shims.

### `packages/client/src/pairing.ts`
`parsePairingUrl(input)` parses the fragment produced by `packages/cli/src/pairing.ts#buildPairingUrl`
(`https://app.pi-studio.sh/#offer=<base64>&host=<...>`) — reads only the substring after `#`, so the
key is provably never taken from a query string or path segment a web server would see. Returns
`{ publicKeyB64, publicKey (decoded bytes), host? }` or `null` if `offer` is absent. Accepts a bare
fragment too (`#offer=...`) for programmatic construction/testing. Uses `@av-pi-studio/relay`'s
`decodeBase64` (task-001) rather than duplicating base64 logic.

Both modules are wired into `packages/client/src/index.ts`'s export barrel.

## Files created / changed
| File | Change |
|------|--------|
| `packages/client/src/relay-transport.ts` | created |
| `packages/client/src/relay-transport.test.ts` | created (6 tests) |
| `packages/client/src/pairing.ts` | created |
| `packages/client/src/transport.ts` | modified — exported `AnyWebSocket`, `WsFactory`, `reasonString` (were module-private) |
| `packages/client/src/index.ts` | modified — export `relay-transport.js`, `pairing.js` |
| `packages/client/package.json` | added `@av-pi-studio/relay` dependency |
| `packages/client/tsconfig.json` | added `{ "path": "../relay" }` project reference |

## How it satisfies the scope
Maps to `architecture/relay-e2ee.md` § Pairing (fragment-only key transfer, verified never crossing
into origin-visible URL parts) and § Behavior (client generates a fresh ephemeral keypair,
`e2ee_hello`/`e2ee_ready` gates all app traffic), and `architecture/client-app-runtime.md` § Layered
client library (relay transport plugged into the same `DaemonClient` transport abstraction as
direct WS — "Transports | websocket transport, relay E2EE transport, ... | Direct vs. relay data
paths").

Deviation/scoping note: the task's "connect to the relay with the session id" step needs a
`sessionId` — since the real relay's registration/routing protocol is explicitly TODO(verify)
upstream, `createRelayTransport` takes `sessionId` as a caller-supplied option (obtained via
whatever rendezvous mechanism connects a pairing scan to a live relay session) rather than
inventing a discovery protocol not specified in scope. This mirrors task-002's same open question
and keeps both sides consistent (`relay_register` frame). App pairing UI polish is explicitly out of
scope per the task file.

## Build & test results
```
$ npm run build:client
> tsc -b packages/client
(clean exit, no output)

$ npx tsc -b --force          # full workspace typecheck
(clean exit, no output)

$ npx oxlint packages/client/src/relay-transport.ts packages/client/src/relay-transport.test.ts packages/client/src/pairing.ts packages/client/src/transport.ts packages/client/src/index.ts
(only pre-existing unicorn(prefer-add-event-listener) warnings, same pattern already present in
 transport.ts before this task — no new lint category introduced)

$ npx vitest run packages/client/src/relay-transport.test.ts
 ✓ packages/client/src/relay-transport.test.ts (6 tests) 28ms

$ npx vitest run          # full workspace suite — no regressions
 Test Files  73 passed (73)
      Tests  481 passed (481)
```

## Acceptance criteria
- [x] A relay-profile connection completes the E2EE handshake before any app RPC — verified by
      "completes the E2EE handshake before any app RPC (hello) crosses the wire": a real
      `DaemonClient.connect()` is driven end-to-end through `createRelayTransport` against a real
      `createDaemonChannel` (task-001) over a fake relay; the daemon side's `onAppMessage` capture
      shows the ONLY plaintext it ever decrypts is the real `hello` RPC — proving it arrived through
      the completed handshake, not as an unencrypted relay-level frame.
- [x] The pairing key is carried in the URL fragment and never reaches the web origin — verified by
      "extracts the offer public key and optional host from a full pairing URL" and "never reaches
      the web origin (only the fragment is parsed, never a query/path segment)" (asserts the
      origin-visible portion of the URL, split at `#`, never contains the key).
- [x] The relay transport is interchangeable with the direct transport via the same API — verified
      structurally ("relay-profile connection is interchangeable...") and functionally by the first
      test using `createRelayTransport` as the `transport` option to a real, unmodified
      `DaemonClient` — the exact same constructor path a direct connection uses.

## Follow-ups / TODO(verify)
- Exact bytes/encoding of the `offer` fragment are TODO(verify) upstream
  (`architecture/relay-e2ee.md`) — this implementation reads it as raw base64 (matching the CLI's
  `buildPairingUrl`'s `publicKeyB64` directly, no re-encoding).
- `sessionId` sourcing (how a client learns the session id to register under, beyond the daemon's
  own registration) is not specified upstream; this task accepts it as a caller-supplied option.
  App-level pairing UI (QR scan → session discovery → `createRelayTransport` construction) is
  explicitly out of scope here per the task file and belongs to a later UI sprint.
- Binary frames (terminal/file-transfer) are not supported over the E2EE relay channel — the
  channel wire format only specifies text app frames. `sendBinary` throws rather than silently
  dropping data.
