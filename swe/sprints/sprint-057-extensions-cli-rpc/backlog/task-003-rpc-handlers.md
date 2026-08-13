# Task 003 — RPC handlers: list (dry-run statuses) + set (persist, sync, report)

- **Sprint:** sprint-057-extensions-cli-rpc
- **Status:** backlog
- **Type:** feature
- **Area:** packages/server (extensions, daemon/bootstrap)
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** task-001, task-002

## Goal

Register the two handlers so a connected client can read curated-pack state and change the selection,
with the selection change taking effect on the **running** daemon, not just on disk.

## Context / why

Thin orchestration: every decision already lives in sprint 056's planner (statuses) and executor
(installs). The handlers translate server types to wire types and nothing else.

Three correctness details carry this task:

1. **`list` must use the planner's dry run, never a second status derivation.** `ExtensionsService.describe()`
   already runs the same pure planner with no writes. One code path for "what we'd do" and "what we
   report" is why the list can never drift from what a sync would actually do — the whole reason the
   planner was built pure and I/O-free.
2. **`set` must update the in-memory selection, not only `config.json`.** `bootstrap.ts` loads config
   **once** and hands it to long-lived services; a handler that persists to disk and stops there would
   leave the running daemon syncing the *old* selection until restart — silently, since the file on
   disk would look correct. The service owns both halves: update its own selection view, then persist.
3. **A `set` without `packs` is the manual-sync path, and it must stay ungated.** `sync("manual")` is
   deliberately exempt from `autoSync` (sprint-056/task-006), because the spec guarantees
   `pi-studio extensions sync` still works with auto-sync off. Routing that command through the
   selection-setting branch instead would both rewrite `config.json` for no reason and silently
   install nothing whenever `autoSync: false`.

## Scope references

- `swe/features/preinstalled-extensions.md` § RPC surface (both rows, the "computed after it
  completes" note, the no-push decision), § Concurrency (mutex + re-plan), § Error Handling (unknown
  slug row)
- `packages/protocol/src/messages.ts` — the pairs from task 001
- `packages/server/src/config/daemon-config.ts` — `persistExtensionPacks` (task 002)
- `packages/server/src/extensions/extensions-service.ts` — `describe()`, `sync()` (sprint-056/task-006)
- `packages/server/src/files/file-watch-rpc.ts` — the `register…Handlers(registry, deps)` +
  `registry.register(type, async (msg, ctx) => …)` idiom to mirror
- `packages/server/src/daemon/bootstrap.ts:450-451` — where sibling `register…Handlers` calls live
- Create: `packages/server/src/extensions/extensions-rpc.ts` (+ `.test.ts`)
- Modify: `packages/server/src/extensions/extensions-service.ts` (add the selection setter),
  `packages/server/src/daemon/bootstrap.ts`

## What to build

**1. `registerExtensionsHandlers(registry, { service, configPath, logger })`** in
`extensions-rpc.ts`, mirroring `registerFileWatchHandlers`:

- `extension_packs_list_request` → `service.describe()`, mapped to the wire shape: `autoSync`,
  `selected`, `packs: PackInfo[]` (grouped by pack, preserving manifest order), `lastSync?: { at,
  outcome }` from the persisted summary. Each `EntryInfo.status` is the planner's status; `lastError`
  comes from the state file's `failures[identity]` (`at`, `attempts`, `reason`, `message`).
- `extension_packs_set_request` — two branches on `packs`:
  - **absent** ⇒ no validation, no persistence, `await service.sync("manual")` (ungated), respond with
    the list-response fields plus `ok: true` and `report`.
  - **present** ⇒ validate slugs against the catalog; unknown slug ⇒ respond
    `{ ok: false, error: "unknown pack: <slug>" }` with **no** persistence and **no** sync. Otherwise
    `service.setSelectedPacks(packs)` (in-memory + `persistExtensionPacks`), then
    `await service.sync("selection")`, then respond with the list-response fields plus `ok: true` and
    `report`.
- Both handlers are read-mostly and need no capability gating beyond the `extensionPacks` feature flag
  already advertised by task 001.

**2. `ExtensionsService.setSelectedPacks(packs)`** — updates the service's own selection view *and*
calls `persistExtensionPacks`. Do it in that order so an in-memory-correct daemon survives a disk
write failure (log the write failure, keep serving). `core` is never stored in the list (it is
implicit); dedupe and preserve caller order otherwise.

**3. Bootstrap registration** — one `registerExtensionsHandlers(...)` call alongside the existing
`register…Handlers` block, using the same `ExtensionsService` instance sprint-056 wired for boot sync
(one service, one mutex — two instances would defeat the serialization).

## Out of scope

- SDK facade (task 004), CLI (task 005), docs (task 006).
- Making `autoSync` settable over the wire — deliberately file/env only in v1.
- Any push/broadcast of progress.
- Re-deriving statuses anywhere outside the planner.

## Acceptance criteria

- [ ] `extension_packs_list_request` on a fresh daemon returns `autoSync: true`, `selected: []`, one
      `PackInfo` for `core` with five `EntryInfo`s, and `lastSync` absent.
- [ ] After a sync with a failure, `list` reports that entry `status: "failed"` with `lastError`
      carrying `attempts`/`reason`/`message`, and `lastSync: { at, outcome }` present.
- [ ] `list` statuses are **identical** to the planner's dry-run output for the same state — asserted
      by comparing against `planSync` directly, so a second derivation cannot creep in.
- [ ] `extension_packs_set_request` with a valid slug persists to `config.json`, runs a sync, and
      returns `report` with `outcome` and `installed`; a subsequent `list` shows the new `selected`.
- [ ] **In-memory effect:** after `set`, a *later* `sync("manual")` on the same running daemon (no
      restart) plans against the new selection — the regression test for the stale-selection bug.
- [ ] Unknown slug ⇒ `{ ok: false, error }`, config.json **unchanged**, no sync spawned, no `report`.
- [ ] `set` **without** `packs` runs `sync("manual")`, leaves `config.json` byte-identical, and leaves
      `selected` unchanged in the response.
- [ ] **Manual sync is ungated:** with `autoSync: false`, a `set` without `packs` still installs
      pending entries (the spec's "`extensions sync` still works" guarantee), while a `set` **with**
      `packs` persists the selection and installs nothing.
- [ ] Deselecting a pack (`set` with a shorter list) never plans removals: previously installed
      entries stay in `settings.json` and keep reporting their statuses, and the triggered sync is a
      `noop` when nothing new is pending (spec: no removals on deselect).
- [ ] With `autoSync: false`, `set` **with** `packs` persists the selection and returns a report with
      **no** installs (`sync("selection")` is gated), while `list` still reports full statuses.
- [ ] Concurrent `set` + boot sync serialize through the single service mutex (asserted with a
      blocking spawn seam; the second run re-plans and sees the first's state).
- [ ] Handlers are registered in `bootstrap.ts` and **not** in `dev-bootstrap.ts`.
- [ ] An `rpc_error` is never used for the unknown-slug case (domain failure ⇒ `ok: false`).

## Test / verification plan

- Build: `npm run build:server` succeeds.
- Typecheck: `npm run typecheck` succeeds.
- Lint/format: `npx oxlint <changed files>`, `npx oxfmt --check <changed files>` clean.
- Tests: create `packages/server/src/extensions/extensions-rpc.test.ts` using the in-process registry
  + fake session context idiom from `file-watch-rpc.test.ts`, an injected spawn seam, and a temp
  `$PI_STUDIO_HOME`; run `npx vitest run packages/server/src/extensions`.
- Extend `packages/server/src/daemon/bootstrap.test.ts` to assert both message types are registered.

## Notes

- `set` returns only when the sync it triggered has finished; a first-run install of five packages can
  exceed the SDK's default 30 s `rpcTimeoutMs`. That is handled **client-side** in task 005 with a
  generous per-call timeout — do not "fix" it here by returning early, and do not shorten the sync.
  An RPC timeout is an operation-level failure that must never close the socket (root invariant 6);
  the sync keeps running server-side regardless.
- Map, do not re-invent: the wire `EntryStatus` (task 001) and the planner's `EntryStatus`
  (sprint-056/task-004) are structurally identical but separately declared, because `protocol` keeps
  zero workspace imports. Keep the mapping total — a `satisfies Record<PlannerStatus, WireStatus>`
  table fails the build if either side ever gains a value.
