# Task 004 — Identity files: the key pair and the server id — Summary

- **Sprint:** sprints/sprint-155-damaged-files
- **Completed:** 2026-11-25
- **Status:** done

## What was implemented
`resolveServerId` and `resolveDaemonKeypair` moved into `daemon/identity-files.ts` (synchronous helpers with the same temp file, fsync, rename and `.corrupt-<UTC>` naming as `atomic-store.ts`; `startDaemon` is synchronous). A missing file is created quietly; a damaged key pair (non-JSON, empty, missing secret, non-string key, `null`) is set aside, replaced atomically at mode 0600 and logged as one error that says pairing links are revoked and devices must pair again; an empty or unreadable `server-id` is set aside and replaced; a failed write is logged at error and the id is used for this run only; if a file cannot be set aside it is left untouched. `daemon rotate-key` now writes a new pair atomically at 0600 (it returns whether a key existed before; it creates a first key if none). `generateDaemonKeypair`, `writeDaemonKeypair` and `DaemonKeypair` are exported from the server's `daemon/index.ts`.

## Files changed
New `daemon/identity-files.ts` and `.test.ts`; `daemon/bootstrap.ts`, `daemon/index.ts`; CLI `daemon-control.ts`, `daemon-commands.ts` (no-key message), `daemon-commands.test.ts`; `AGENTS.md` of both packages.

## Build & test results
```
npx vitest run packages/server/src/daemon packages/cli/src -> pass (one flaky slow-client e2e passed alone); build:server and build:cli OK
Full-tree gate: build, typecheck 0 errors; lint 0 errors; npm test (three runs) 349 files, 5087 tests passed
```

## Acceptance criteria
- [x] Corrupt key pair: a `.corrupt-*` file holds the original bytes, the new file is 0600, one error is logged
- [x] A home where `server-id` cannot be written: the failure is logged
- [x] `rotate-key` never leaves a half-written file (a server-layer crash simulation of the final rename; the CLI tests cover mode 0600, replacement and no leftovers)

## Follow-ups / TODO(verify)
- The timestamp and set-aside logic duplicates `atomic-store.ts` (async there, sync here); deduplicate later with sync variants if wanted.
- An `ENOTDIR` read error is treated as "nothing there", not damage.
