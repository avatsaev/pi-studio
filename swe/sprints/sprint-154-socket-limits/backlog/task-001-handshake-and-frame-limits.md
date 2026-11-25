# Task 001 — A time limit for `hello`, a frame size limit, and a cap on requests in flight

- **Sprint:** sprints/sprint-154-socket-limits
- **Status:** backlog
- **Type:** bugfix
- **Area:** packages/server (ws server, router, relay sessions)
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** sprint-153/task-004

## Goal
A connection cannot be held open without identifying itself, cannot send a frame of any size, and
cannot start an unlimited number of requests.

## Context / why
Finding T3, unchanged for direct sockets. A socket that never sends `hello` is held for ever. The
server is created without `maxPayload`, so the library's 100 MiB applies. Every text frame is
dispatched at once with no cap. Each binary frame is copied.

## Scope references
- `docs/daemon-audit-handoff.md` § "M5 choices" (sockets), § T3
- `packages/server/src/ws/ws-server.ts` (options :75-83, the `message` handler, the binary copy
  near :172), `ws/router.ts` (`routeTextFrame`, the `void` dispatch at `bootstrap.ts` near :838)
- `packages/server/src/daemon/relay-sessions.ts` (`attachRelaySession` :72-150)
- Limits elsewhere: uploads use 32 KiB chunks; the desktop proxy carries up to 128 MiB
  (`desktop/crates/net/src/limits.rs`); the relay carries 100 MiB (`packages/relay/src/control.ts`)

## What to build
- A direct socket, and a relay session after its key exchange, that has not sent a valid `hello`
  within `HELLO_TIMEOUT_MS = 10_000` is closed with 1008.
- `maxPayload` on the direct server: find the largest frame a real client sends (a prompt with
  images, a file write, an upload chunk, terminal input) and set `MAX_FRAME_BYTES` above it with
  margin; 32 MiB unless that search says otherwise. An oversize frame closes the socket with 1009.
- At most `MAX_INFLIGHT_REQUESTS = 64` requests in flight per session; one more is answered with
  `rpc_error` code `too_many_requests`. No ordering is imposed.
- Binary frames are passed as a view of the received buffer, after checking that no handler keeps the
  bytes beyond its own copy (the upload path writes them).

## Out of scope
Liveness (task-002) and send queues (task-003).

## Acceptance criteria
- [ ] A silent socket is closed at the limit (short injected limit); a normal client is not.
- [ ] An oversize frame closes that socket with 1009 and other sessions go on.
- [ ] The 65th concurrent slow request gets `too_many_requests`; the first 64 complete.
- [ ] Uploads stay byte-exact (existing transfer tests), on direct and relay sessions.

## Test / verification plan
- `npx vitest run packages/server/src/ws packages/server/src/daemon packages/server/src/files`
- `npm run build:server`
