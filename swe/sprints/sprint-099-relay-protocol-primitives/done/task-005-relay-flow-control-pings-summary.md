# Task 005 — Relay flow control, pings, shutdown — Summary

- **Sprint:** sprints/sprint-099-relay-protocol-primitives
- **Completed:** 2026-11-15
- **Status:** done

## What was implemented
In `relay-server.ts`: per-direction flow control (pause the sender's socket when the receiver's `bufferedAmount` > `flowHighWaterBytes`; a 10 ms poll resumes at `flowLowWaterBytes`; paused senders released when a pair ends and at shutdown); pings every `pingIntervalMs` (30 s) to every socket incl. parked ones, two unanswered → close `4108 ping_timeout` (partner closed with the same code); `close()` sends `1001 "going away"` to all sockets, waits ≤2 s, terminates leftovers, closes HTTP. Test accessor `handle.flow()` → `{pausedDirections, peakQueuedBytes}`.

## Files created / changed
| File | Change |
|------|--------|
| `packages/relay/src/relay-server.ts` | modified |
| `packages/relay/src/relay-server.test.ts` | +13 tests (44 total) |
| `packages/relay/AGENTS.md` | flow control, pings, shutdown, `flow()` documented |

## How it satisfies the scope
relay-protocol.md § 2 (ping, flow control), § 3 (4108, 1001). Deviations: paused senders are exempt from ping timeout (the relay itself stopped reading them); 1001 reason string is "going away".

## Build & test results
```
$ npx vitest run packages/relay/src -> 7 files, 92 passed
$ npm run build:relay -> success; oxfmt/oxlint clean
```

## Acceptance criteria
- [x] bounded queue + resume at low mark (peak queued 98 316 B with 64 KiB high mark; daemon-side buffered > 32 MiB); other pair keeps flowing; 4108 after two unanswered pings, parked/control/pair answering pings stay open; `close()` sends 1001 to every socket; t004 tests pass

## Follow-ups / TODO(verify)
- A receiver draining slower than ~1 MiB per two ping intervals can be timed out because the ping queues behind data (as the spec says). Noted in AGENTS.md.
