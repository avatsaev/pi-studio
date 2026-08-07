# Task 004 — Cloudflare relay server adapter — Summary

- **Sprint:** sprint-032-relay-e2ee
- **Completed:** 2026-07-18
- **Status:** done

## What was implemented

### `packages/relay/src/session-bridge.ts` — `RelaySessionBridge`
The platform-agnostic bridging core, reusable by ANY relay server implementation (Cloudflare
adapter here; a self-hosted Go/Node relay could use the same class if written in TS, or mirror its
algorithm). `attach(socket)` inspects **only the first frame** a socket ever sends to detect
`{"type":"relay_register","sessionId":"..."}` (the same convention `packages/server/src/daemon/
relay-transport.ts` (task-002) and `packages/client/src/relay-transport.ts` (task-003) already use).
Every subsequent frame is forwarded **verbatim** — no `JSON.parse`, no inspection — to every OTHER
socket registered under the same session id. This is the literal implementation of the spec's trust
boundary: "a compromised relay can see only metadata... never message contents, and it cannot forge
or inject commands" — the bridge structurally cannot read app content because nothing in its code
path ever looks at it past the registration check.

### `packages/relay/src/cf-adapter.ts` — `createCloudflareRelayHandler`
A thin Cloudflare Workers wrapper around the bridge. On a WebSocket upgrade request it creates a
`WebSocketPair`, `.accept()`s the SERVER side, attaches it to the `RelaySessionBridge`, and returns
the CLIENT side for the caller's `fetch` handler to return in a `101` response. Declares its own
minimal **structural** `CfWebSocket`/`CfWebSocketPair` types (accept/send/addEventListener/close)
instead of depending on `@cloudflare/workers-types` — keeping this package's zero-runtime-dependency
posture (only `tweetnacl`) and avoiding a large type-only package pulling in ambient globals that
could collide with this package's Node-targeted `tsconfig`. The real Workers runtime's objects
satisfy the structural shape naturally; `createWebSocketPair` is injectable for tests since
`WebSocketPair` only exists inside the actual Workers runtime.

## Files created / changed
| File | Change |
|------|--------|
| `packages/relay/src/session-bridge.ts` | created |
| `packages/relay/src/session-bridge.test.ts` | created (5 tests) |
| `packages/relay/src/cf-adapter.ts` | created |
| `packages/relay/src/cf-adapter.test.ts` | created (4 tests) |
| `packages/relay/src/index.ts` | modified — export `session-bridge.js`, `cf-adapter.js` |
| `packages/relay/AGENTS.md` | modified — documented the new modules, public API, invariant |

## How it satisfies the scope
Maps to `architecture/relay-e2ee.md` § Channel API ("Cloudflare adapter | server | Relay server
implementation hook for Cloudflare Workers") and § Purpose ("a compromised relay can see only
metadata... never message contents, and it cannot forge or inject commands"), and
`MAIN-SCOPE.md` § 6 (Relay integration: "WebSocket + NaCl box... Hosted or self-hosted").

Deviation/scoping note: "Hosted deployment/ops" is explicitly out of scope per the task file — no
`wrangler.toml`, no actual `fetch` export, no Durable Object class registration. What's built is the
reusable bridging **hook** (`RelaySessionBridge` + `createCloudflareRelayHandler`) that a real
deployment's `fetch` handler would call in ~3 lines; that hook is fully exercised by tests.

## Build & test results
```
$ npm run build:relay
> tsc -b packages/relay
(clean exit, no output)

$ npx tsc -b --force          # full workspace typecheck
(clean exit, no output)

$ npx oxlint packages/relay/src
(clean exit, no warnings)

$ npx vitest run packages/relay/src/
 ✓ packages/relay/src/base64.test.ts (3 tests) 2ms
 ✓ packages/relay/src/cf-adapter.test.ts (4 tests) 2ms
 ✓ packages/relay/src/channel.test.ts (6 tests) 19ms
 ✓ packages/relay/src/session-bridge.test.ts (5 tests) 326ms
 Test Files  4 passed (4)
      Tests  18 passed (18)

$ npx vitest run          # full workspace suite — no regressions
 Test Files  75 passed (75)
      Tests  490 passed (490)
```

## Acceptance criteria
- [x] A daemon registers a session id and a client attaches to the same session and is bridged —
      verified by "a daemon registers a session id and a client attaches to the same session and is
      bridged" (`session-bridge.test.ts`, against REAL independent WebSocket connections into a test
      relay server) and by the Cloudflare-shaped equivalent in "accepts a WebSocket upgrade..." /
      "forwards frames verbatim between two Workers-adapter-accepted sockets sharing a session id"
      (`cf-adapter.test.ts`).
- [x] The relay forwards frames verbatim and cannot read/forge/inject (no shared key) — verified by
      "forwards frames verbatim and never parses/inspects app content" (an opaque ciphertext-shaped
      string round-trips byte-for-byte) and, most rigorously, "the bridge cannot read/forge/inject —
      a real E2EE handshake + app message crosses it with no plaintext ever visible on the wire":
      runs REAL `createDaemonChannel`/`createClientChannel` (task-001) end-to-end through the bridge
      over real WebSocket connections, sends a genuine secret app message, confirms the daemon
      actually decrypted it (proving the message traveled and authenticated), then asserts every
      single frame ever transmitted on the wire is free of both that plaintext and the daemon's raw
      secret key.
- [x] Relay restart/drop → client and daemon reconnect into a new session with new keys — verified
      by "relay restart/drop → client and daemon reconnect into a new session with new keys" (a
      fresh `RelaySessionBridge`/server instance, modeling a Durable Object restart, carries no
      state from the old session id forward; new registrations under a new session id work
      cleanly).

## Follow-ups / TODO(verify)
- Relay routing/session-id assignment protocol details remain TODO(verify) upstream
  (`architecture/relay-e2ee.md`) — this bridge's registration frame convention
  (`{ type: "relay_register", sessionId }`) is the same choice made consistently across
  task-002/003/004 in this sprint; if the real upstream protocol differs, all three need to change
  together.
- Hosted deployment/ops (wrangler config, the actual Cloudflare `fetch` export wiring, Durable
  Object class registration for session-affinity across Worker isolates) is explicitly out of
  scope — `createCloudflareRelayHandler` is the reusable hook a real deployment's `fetch` handler
  calls, not a deployable Worker itself.
- The Go self-hosted implementation (alternate relay server) is explicitly out of scope per the
  task file; `RelaySessionBridge`'s algorithm is simple enough to port directly if that becomes a
  future task.
