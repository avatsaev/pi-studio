# Task 003 — RPC handlers: list (dry-run statuses) + set (persist, sync, report) — Summary

- **Sprint:** sprint-057-extensions-cli-rpc
- **Completed:** 2026-08-13
- **Status:** done

## What was implemented

`registerExtensionsHandlers(registry, { service, logger })` in a new
`packages/server/src/extensions/extensions-rpc.ts`, mirroring `registerFileWatchHandlers`:

- `extension_packs_list_request` → `service.describe()` (the same pure planner dry-run sprint-056
  built, no second status derivation), mapped to the wire `PackInfo[]`/`EntryInfo` shape via a total
  `Record<PlannerEntryStatus, string>` mapping table (a build error, not a silent gap, the moment
  either side gains a status the other doesn't handle).
- `extension_packs_set_request` — two branches on `packs`: **absent** → no validation, no
  persistence, `await service.sync("manual")` (ungated); **present** → validate against the catalog,
  unknown slug → `{ ok: false, error }` with no persistence/sync, otherwise
  `service.setSelectedPacks(packs)` then `await service.sync("selection")`. Both branches respond
  with the list-response fields **recomputed via a fresh `describe()` call after the sync
  completes**, so the response reflects post-sync reality, never a stale pre-sync view.

`ExtensionsService` (sprint-056) gained: a `configPath` dep (optional, defaults to
`<home>/config.json` — mirrors bootstrap's own default, so every pre-existing sprint-056 test
construction needed zero changes); `setSelectedPacks(packs)` (updates the in-memory
`config.daemon.extensions.packs` array *then* persists via `persistExtensionPacks`, in that order, so
a disk-write failure never desyncs the running daemon — logged, never thrown); and `describe()` now
attaches `lastError` per entry from the same state-file read it already performs (a new
`DescribedEntry` type extending `PlannedEntry`) — never a second `loadExtensionsState` call, so it
can't interleave with the mutex-guarded sync writing the same file.

`bootstrap.ts`: `ExtensionsService` now receives `configPath`; one
`registerExtensionsHandlers(registry, { service: extensionsService, logger: extensionsLogger })` call
added alongside the sibling `register…Handlers` calls, using the same service instance sprint-056
wired for boot sync (one service, one mutex). `dev-bootstrap.ts` was not touched at all.

## Files created / changed

| File | Change |
|------|--------|
| `packages/server/src/extensions/extensions-rpc.ts` | created — the two handlers |
| `packages/server/src/extensions/extensions-rpc.test.ts` | created — 10 tests |
| `packages/server/src/extensions/extensions-service.ts` | `configPath` dep, `setSelectedPacks`, `DescribedEntry`/`lastError` in `describe()` |
| `packages/server/src/daemon/bootstrap.ts` | wired `configPath`, registered the new handlers |
| `packages/server/src/daemon/bootstrap.test.ts` | added `extension_packs_list_request` to the full-RPC-surface probe; added a dedicated E2E describe block (real WS round trip: list, set, config.json persistence) |

## How it satisfies the scope

Matches every item in the task's "What to build" and every acceptance criterion. One documented,
deliberate scope note: only `core` exists in the curated-packs manifest today (sprint-056 shipped no
second audience pack), so "set with a valid non-core slug" and "deselecting a pack" are exercised
using the empty selection (`packs: []`) — the only non-error selection reachable against the real
manifest — rather than a fabricated slug. The removal-safety property itself ("deselect never plans
removals") is structural: `sync-planner.ts`'s `planSync` has no removal action type at all, already
proven by sprint-056's `sync-planner.test.ts`; this task's tests additionally prove the *RPC layer*
never diverges from that (statuses-identical-to-planner test) and that a triggered sync is `noop`
when nothing new is pending.

## Build & test results

```
$ npm run build:server
> tsc -b packages/server && chmod +x packages/server/dist/daemon/main.js
(success)

$ npx oxfmt --check packages/server/src/extensions/extensions-rpc.ts packages/server/src/extensions/extensions-rpc.test.ts packages/server/src/extensions/extensions-service.ts packages/server/src/daemon/bootstrap.ts packages/server/src/daemon/bootstrap.test.ts
All matched files use the correct format.

$ npx oxlint <same files>
(clean — 0 new warnings; 1 pre-existing warning in bootstrap.ts confirmed via git stash to predate this change)

$ npm run clean && npm run typecheck
> tsc -b   (full workspace — success, no errors)

$ npx vitest run packages/server
Test Files  58 passed (58)
     Tests  621 passed (621)
   [extensions-rpc.test.ts: 10 new; bootstrap.test.ts: 30 passed, up from 28 baseline;
    extensions-service.test.ts: 12 passed, unchanged — configPath default kept every
    pre-existing construction working with zero test-file changes]
```

## Acceptance criteria

- [x] Fresh daemon `list` → `autoSync: true`, `selected: []`, one `PackInfo` for `core` with five
      `EntryInfo`s, `lastSync` absent.
- [x] After a sync with a failure, `list` reports that entry `status: "failed"` with `lastError`
      (`attempts`/`reason`/`message`), and `lastSync: { at, outcome }` present.
- [x] `list` statuses are identical to the planner's dry-run output for the same state — asserted by
      comparing against `planSync` directly.
- [x] `set` with a valid (empty) selection persists to `config.json`, runs a sync, returns `report`
      with `outcome`/`installed`; a subsequent `list` shows the new `selected`.
- [x] In-memory effect: after `set`, a later `sync("manual")` on the same running daemon (no restart)
      plans against the new selection — the regression test for the stale-selection bug.
- [x] Unknown slug ⇒ `{ ok: false, error }`, `config.json` unchanged (never even created), no sync
      spawned, no `report`.
- [x] `set` without `packs` runs `sync("manual")`, leaves `config.json` byte-identical, leaves
      `selected` unchanged in the response.
- [x] Manual sync is ungated: with `autoSync: false`, `set` without `packs` still installs pending
      entries; `set` **with** `packs` installs nothing.
- [x] Deselecting (empty selection) never plans removals; the triggered sync is `noop` when nothing
      new is pending.
- [x] With `autoSync: false`, `set` **with** `packs` persists the selection and returns a report with
      no installs; `list` still reports full statuses.
- [x] Concurrent `set` + boot sync serialize through the single service mutex.
- [x] Handlers registered in `bootstrap.ts`; `dev-bootstrap.ts` untouched.
- [x] `rpc_error` is never used for the unknown-slug case (`ok: false` domain response instead).

## Follow-ups / TODO(verify)

- None. Tasks 005/006 (CLI, E2E+docs) consume this RPC surface next.
