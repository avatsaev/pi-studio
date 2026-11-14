# Task 004 — SDK: buffered amount on Transport, paced streaming upload — Summary

- **Sprint:** sprints/sprint-096-desktop-protocol-followups
- **Completed:** 2026-11-14
- **Status:** done

## What was implemented
`Transport.bufferedAmount?` (WebSocket and relay transports report it; DaemonClient forwards it). `FileTransferClient.upload(path, source, {onProgress?, signal?})` takes Uint8Array | Blob | AsyncIterable<Uint8Array>, streams Blob slices without a whole-file read, paces on bufferedAmount (UPLOAD_HIGH_WATER_BYTES 1 MiB, 10 ms poll), sends ack:true under fileTransferAck and resolves on file_upload_complete (rejecting with the daemon's error, no timeout on the wait), falls back to draining the buffer, cancels with an Error frame + AbortError, and leaves no listener/stream on any exit. Implemented by a subagent (SdkPacedUpload); reviewed and its real-daemon test moved from packages/client to packages/cli.

## Files created / changed
| File | Change |
|------|--------|
| `packages/client/src/{transport,relay-transport,daemon-client}.ts` | bufferedAmount |
| `packages/client/src/file-transfer-client.ts` | new upload() |
| `packages/client/src/file-transfer-upload.test.ts` | 19 tests, fake transport with scripted bufferedAmount |
| `packages/cli/src/file-transfer-sdk-e2e.test.ts` | 4 tests vs a real dev daemon (bytes on disk) |
| `packages/client/AGENTS.md` | signature, Transport.bufferedAmount, behaviours |

## How it satisfies the scope
No download changes; web-client wiring is task-005. src/ uses `new Promise` instead of Promise.withResolvers because the client compiles with lib ES2023 and ships to older browser/RN runtimes.

## Build & test results
```
packages/client + cli e2e vitest pass (client 12 files; whole run protocol+server+client+cli e2e = 120 files / 1837 tests); tsc -b clean; oxlint clean on touched files (pre-existing warnings only); oxfmt --check clean on changed files. Bound test: buffered amount never exceeds high-water + one frame for an 8x source.
```

## Acceptance criteria
['Bounded buffered amount asserted: met.', 'Resolves only after the ack; daemon failure rejects with its error: met (fake transport + real daemon).', 'No-flag daemon completes with correct bytes: met (fake transport).', 'Aborted upload leaves nothing pending: met (`pendingUploads` is 0).', 'AGENTS documented: met.', 'Handoff doc: updated (Transport.bufferedAmount, SDK upload facts).']

## Follow-ups / TODO(verify)
- Relay-specific bufferedAmount behaviour is read, not tested.
- Browser host still reads the whole file (task-005).
