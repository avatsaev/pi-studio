# Task 001 — A time limit for `hello`, a frame size limit, and a cap on requests in flight — Summary

- **Sprint:** sprints/sprint-154-socket-limits
- **Completed:** 2026-11-25
- **Status:** done

## What was implemented
New `ws/limits.ts`: `HELLO_TIMEOUT_MS = 10_000`, `MAX_FRAME_BYTES = 32 MiB`, `MAX_INFLIGHT_REQUESTS = 64`. A direct socket that has not sent a valid `hello` within the limit is closed with 1008 (`hello timeout`); for relay sessions the clock starts when the key exchange completes (new `RelayConnection.onReady(handler)`, because `onConnection` fires at dial time). `maxPayload` on the direct server closes an oversize frame with 1009 (a `ws.on("error")` handler was added, since the library emits `error` on one). A `WeakMap` counter in `router.ts` caps requests in flight per session (direct and relay): the 65th gets `rpc_error` `too_many_requests` (a message without a `requestId` is dropped and logged); the slot frees after the reply and its hooks or when the handler threw; `ping`/`pong` are not counted. Binary frames are passed as a view of the received buffer (both decoders already `slice()` what they keep). 32 MiB was kept after checking the largest legitimate frame (uploads send 32 KiB chunks, file saves cap at 5 MiB, a prompt's images fit).

## Files changed
`packages/server/src/ws/{limits,router,ws-server,index}.ts` (+ router and ws-server tests), `daemon/{relay-sessions,relay-connection}.ts` (+ tests), `files/file-transfer.test.ts`; protocol: `messages.ts` comment, `rpc_error.json`, `CHANGELOG.md` (adds `too_many_requests`; signatures unchanged), `AGENTS.md`; `packages/server/AGENTS.md`.

## Build & test results
```
npx vitest run packages/server/src/{ws,daemon,files} packages/protocol -> 41 files, 786 passed (incl. external-fixtures-e2e); build:protocol, build:server OK; oxlint clean
```

## Acceptance criteria
- [x] A silent socket is closed at the limit (short injected limit; relay with fake timers); a normal client is not
- [x] An oversize frame (a real 32 MiB + 1) closes that socket with 1009; other sessions go on
- [x] The 65th concurrent slow request gets `too_many_requests`; the first 64 complete (router and relay connection)
- [x] Uploads stay byte-exact (a new test overwrites the source buffer after each view)

## Follow-ups / TODO(verify)
- No separate relay upload test (relay sessions use the same binary handler).
- `oxfmt --check` flags `ws/session-subscriptions.test.ts`, an untouched pre-existing file.
