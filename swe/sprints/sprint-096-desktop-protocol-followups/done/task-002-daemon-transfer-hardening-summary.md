# Task 002 — Daemon transfer hardening: paced download, clean error, owned upload streams — Summary

- **Sprint:** sprints/sprint-096-desktop-protocol-followups
- **Completed:** 2026-11-14
- **Status:** done

## What was implemented
Session gained `bufferedAmount`/`isOpen`. `startDownload` takes optional pacing: pauses the disk read above 1 MiB queued, resumes at 256 KiB, polling 10 ms; a read error sends one Error and no End (RPC ok:false read_failed); a closed socket ends the transfer silently. Uploads record the owning session id; foreign frames are ignored; `disposeSession` (direct close + relay reset) frees streams and closes handles; frames carry their PendingUpload so a recycled stream id is never hit by stale frames.

## Files created / changed
| File | Change |
|------|--------|
| `packages/server/src/files/file-transfer.ts` | paced download, owned streams, dispose |
| `packages/server/src/ws/session.ts` | bufferedAmount, isOpen |
| `packages/server/src/daemon/bootstrap.ts` | disposeSession wiring |
| `packages/server/src/files/file-transfer.test.ts` | new cases |

## How it satisfies the scope
Chunk size, opcodes and token flow untouched. Water marks are chosen, not measured (injectable). The relay's stand-in socket cannot report a queue, so relay downloads stay unpaced.

## Build & test results
```
Tests (server files suite 77 pass): peak queue bounded for a 300 kB file over a socket draining 4 KiB/2 ms (asserts <= high-water + one chunk), unpaced when the queue is unknown, Error without End, closed socket mid-download sends nothing more, foreign-session frames ignored then owner completes, session close frees the stream and stops writes. Live slow-client check is deferred to task-008.
```

## Acceptance criteria
['Slow download bounded, asserted: met (fake socket).', 'Read error produces Error only: met.', 'Foreign frame no effect: met.', 'Disconnect leaves no handle/stream: met (stream freed and later frames ignored; handle close is awaited on the chain, not observable on Linux).', 'Existing transfer tests pass: met.']

## Follow-ups / TODO(verify)
- Real-socket confirmation of bounded buffering over a slow `ws` client is task-008.
Docs in this task: protocol/client/server/workbench AGENTS + workbench README, root AGENTS protocol overview, desktop-client-handoff.md (status rows, client-type paragraph, transfer facts), the follow-ups spec status + TODO(verify) decisions. The handoff doc now states: platform is accepted by 0.0.117 (checked), invalid hello closes 1008 on direct, upload ack and pacing facts.
