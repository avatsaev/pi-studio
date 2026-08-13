# Task 001 — Protocol: `extension_packs_list`/`_set` pairs + `extensionPacks` server feature — Summary

- **Sprint:** sprint-057-extensions-cli-rpc
- **Completed:** 2026-08-13
- **Status:** done

## What was implemented

Added the two flat snake_case RPC pairs (`extension_packs_list_request`/`_response`,
`extension_packs_set_request`/`_response`) to `packages/protocol/src/messages.ts`'s session-message
union, plus the `extensionPacks` `SERVER_FEATURES` flag with its `COMPAT` tag. `EntryStatus`,
`SyncOutcome`, and `ExtensionFailureReason`-carrying fields (`status`, `outcome`, `reason`) are all
`z.string()` on the wire (never narrowed enums) per the append-only rule; the TS unions
(`EntryStatus`, `SyncOutcome`) are documentation-only exports mirroring
`packages/server/src/extensions/{sync-planner,sync-executor}.ts`'s types without importing them
(protocol keeps zero workspace imports). `lastSync` is a strict `{ at, outcome }` summary schema,
structurally distinct from the full `extensionSyncReportSchema` (`report` on the set response), so it
can never accidentally grow `installed`/`failures`. `extension_packs_set_request.packs` is optional —
its absence is the manual-sync trigger. `extension_packs_set_response` carries domain `ok`/`error`
fields (mirroring `file_watch_subscribe_response`), with `report` optional since a rejected request
runs no sync. All new object schemas use `.passthrough()` per the project's forward-compat convention.

## Files created / changed

| File | Change |
|------|--------|
| `packages/protocol/src/messages.ts` | added `extensionEntryInfoSchema`, `extensionPackInfoSchema`, `extensionSyncFailureSchema`, `extensionSyncReportSchema`, `extensionsLastSyncSummarySchema`, `extensionPacksListRequestSchema`/`Response`, `extensionPacksSetRequestSchema`/`Response` (+ inferred types), wired into `sessionMessageSchema` |
| `packages/protocol/src/client-capabilities.ts` | added `extensionPacks` to `SERVER_FEATURES` + its `SERVER_FEATURE_COMPAT` entry |
| `packages/protocol/src/client-capabilities.test.ts` | updated exact-key-list assertion to include `extensionPacks` |
| `packages/protocol/src/session-messages.test.ts` | added `describe("extension packs (sprint-057)")` — 6 new tests |

## How it satisfies the scope

Maps directly to `swe/features/preinstalled-extensions.md` § RPC surface and the task's own "What to
build" table/interfaces — every field name, optionality, and shape decision (lastSync-is-a-summary,
packs-optional-is-manual-sync, ok/error-are-domain-fields) is implemented as specified. No deviations.

## Build & test results

```
$ npm run build:protocol
> tsc -b packages/protocol
(success, no output)

$ npx oxfmt --check packages/protocol/src/messages.ts packages/protocol/src/client-capabilities.ts packages/protocol/src/client-capabilities.test.ts packages/protocol/src/session-messages.test.ts
All matched files use the correct format.

$ npx oxlint packages/protocol/src/messages.ts packages/protocol/src/client-capabilities.ts packages/protocol/src/client-capabilities.test.ts packages/protocol/src/session-messages.test.ts
0 new warnings (10 pre-existing warnings on unrelated lines, confirmed via git stash to predate this change)

$ npm run clean && npm run typecheck
> tsc -b   (full workspace, all packages — success, no errors)

$ npx vitest run packages/protocol
Test Files  10 passed (10)
     Tests  94 passed (94)   [session-messages.test.ts: 39 passed, up from 30 baseline]
```

## Acceptance criteria

- [x] Both pairs parse through the session-message union with realistic payloads, including a
      `lastSync`-absent list response and a `report`-bearing set response.
- [x] `lastSync` accepts exactly `{ at, outcome }` and rejects nothing extra (passthrough), typed as
      the summary — no `installed`/`failures` fields on it.
- [x] An `EntryInfo` with an unknown future `status` string, a `SyncReport.failures[].reason` with an
      unknown value, and a `lastSync.outcome` with an unknown value all still parse.
- [x] `extension_packs_set_request` validates with `packs` (selection change) and without it
      (manual-sync trigger).
- [x] `extension_packs_set_response` carries `ok: false` + `error` for a rejected slug and validates
      without `report`; an `ok: true` response validates with `report` present.
- [x] `SERVER_FEATURES` gains `extensionPacks`; `client-capabilities.test.ts`'s exact-key-list
      assertion updated; every feature still has a `COMPAT` tag (existing invariant test untouched).
- [x] No existing message type, field, or enum value removed, renamed, or narrowed.

## Follow-ups / TODO(verify)

- None. Handlers (task 003), SDK facade (task 004), and CLI (task 005) consume this contract next.
