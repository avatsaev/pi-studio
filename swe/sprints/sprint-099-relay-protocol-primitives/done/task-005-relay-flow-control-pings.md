# Task 005 — Relay server: per-direction flow control, pings, shutdown

- **Sprint:** sprint-099-relay-protocol-primitives
- **Status:** done
- **Type:** feature
- **Area:** packages/relay
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-004

## Goal
The relay holds at most about 1 MiB queued per direction of a pair, detects dead sockets with pings, and closes everything with 1001 on shutdown.

## Context / why
Today the relay calls `ws.send` without looking at the queue, so a slow receiver makes the relay buffer a whole download in memory. A half-open socket is never detected. Pausing the sender's socket lets TCP backpressure reach the daemon, whose download pacing then works through the relay (D1, D6, D17).

## Scope references
- `swe/architecture/relay-protocol.md` § 2 (Ping, Flow control), § 3 (4108, 1001), § Behavior — Relay (piping, every 30 s, on shutdown), § Acceptance criteria (flow control, timers, parked sockets pinged)
- `swe/features/relay-multi-client.md` D17, D18
- Modify: `packages/relay/src/relay-server.ts`, `packages/relay/src/relay-server.test.ts`

## What to build
- Piping a → b: when b's `bufferedAmount` exceeds the high mark (1 MiB), pause a (`ws` `socket.pause()`); when b drains to the low mark (256 KiB) or below, resume a. Each direction of each pair is independent. Watch the drain with a short poll or the socket's send callbacks; any mechanism will do as long as memory stays bounded.
- Ping every socket every 30 s, parked ones included (D3: an old daemon answers pings and is never closed). A socket with two unanswered pings is closed `4108 ping_timeout`. Ping interval injectable through `limits`.
- `handle.close()` closes every socket with 1001, then the HTTP server.

Package docs: run alone, document flow control and pings in `packages/relay/AGENTS.md`. In a parallel wave, put the edits in the summary.

## Out of scope
- Daemon-side silence detection (sprint-100/task-003). Client connect timeout (sprint-100/task-004).

## Acceptance criteria
- [ ] With a receiver that stops reading, the relay stops reading the sender once more than the high mark is queued, and resumes at the low mark (asserted with small injected marks: the sender's own `bufferedAmount` grows while the relay is paused, and relay-side queued bytes stay bounded).
- [ ] The other pair of the same daemon keeps flowing while one pair is paused.
- [ ] A socket that stops answering pings is closed with 4108 after two intervals. A parked socket that answers pings stays open.
- [ ] `close()` sends 1001 to every open socket.
- [ ] All task-004 tests still pass.

## Test / verification plan
- `npx vitest run packages/relay/src/relay-server.test.ts`
- `npm run build:relay`
- `npx oxfmt <changed files>`

## Notes
- A test client that stops reading: pause its underlying `ws` socket (`socket.pause()` on the client side) so TCP fills.
- Large-transfer memory proof through a real daemon is sprint-101/task-001. This task proves the mechanism.
