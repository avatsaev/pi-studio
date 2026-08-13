# Task 004 — Summary

- **Sprint:** sprint-056-extensions-sync-engine
- **Status:** done

## What was built

- `packages/server/src/extensions/sync-planner.ts` — `planSync(input): SyncPlan`, a pure function
  (no filesystem, no process, no clock). Implements the spec's `planEntry` pseudocode per selected
  entry, in this order: `deprecated` tombstone check first (no action ever, regardless of `offered`
  state) → `state === "unreadable"` fail-safe (zero actions, status reported as `"installed"` —
  "treat every identity as already offered", never `"pending"`, since nothing will actually retry
  until the state file is fixed) → not-yet-`offered` (`"pending"`, action planned; `"failed"`
  instead if a `failures` record exists for that identity, action still planned unconditionally) →
  offered-and-absent-from-settings (`"user_removed"`) → offered-and-differs
  (`"user_modified"`, including the object-form case, which is **always** `user_modified`
  regardless of whether the object's own `.source` byte-matches — see `findByIdentity`) → otherwise
  `"installed"`.
- `findByIdentity`/`packageSourceString` match pi's own settings-entry duality
  (`getPackageSourceString`, package-manager.js: `typeof pkg === "string" ? pkg : pkg.source`) —
  string or object form, object form's `.source` extracted but the match is still flagged
  `isObjectForm` so the caller can force `user_modified`. Entries that don't parse as `npm:`/`git:`
  (the user's own local-path packages) are skipped, never touched.
- `packages/server/src/extensions/sync-planner.test.ts` — 15 table-driven tests: fresh state (five
  pending + five actions against the real `CURATED_PACKS`, plus a 3-entry fixture catalog for the
  rest so tests don't churn on manifest growth), steady state (zero actions, all `installed`), the
  three terminal statuses (`user_removed`, `user_modified` by version pin, `user_modified` by object
  form even when `.source` matches), `deprecated` in both never-offered and
  already-offered-and-installed shapes, `failed` + unconditional retry, invisibility of the user's
  own non-curated packages, the `"unreadable"` fail-safe, pack-selection (unknown slug ignored,
  `core` always present, extra pack adds its entries), and two no-I/O guards (source-inspection that
  `sync-planner.ts` imports no `node:fs`/`node:child_process`; the input array is never mutated).

## Test / verification results

- `npx vitest run packages/server/src/extensions/sync-planner.test.ts` — 15 tests, **pass**.
- `npm run build:server` — pass.
- `npm run typecheck` — pass.
- `npx oxlint packages/server/src/extensions/sync-planner.ts
  packages/server/src/extensions/sync-planner.test.ts` — clean.
- `npx oxfmt --check <changed files>` — clean (one scoped auto-fix pass on the test file).

## Acceptance criteria

- [x] Fresh state, default selection ⇒ five `pending` entries and five actions, manifest order.
- [x] Every entry already `offered` with a byte-identical settings entry ⇒ zero actions, all
      `installed`.
- [x] Offered + absent from settings ⇒ `user_removed`, no action.
- [x] Offered + settings entry differing by a version pin ⇒ `user_modified`, no action.
- [x] Offered + settings entry in object form ⇒ `user_modified`, no action.
- [x] `deprecated: true` ⇒ `deprecated` and no action, both never-offered and
      already-offered-and-installed.
- [x] A `pending` entry with a `failures` record ⇒ `status: "failed"`, action still planned.
- [x] Identities in `settingsPackages` not in the manifest never appear in `entries`.
- [x] `state: "unreadable"` ⇒ zero actions.
- [x] Unknown selected slug ⇒ ignored; `core` always included even when `packs` is empty.
- [x] No I/O: verified by direct inspection of `sync-planner.ts`'s own source (no `node:fs`/
      `node:child_process` import) plus fixture-objects-only test bodies.

## Notes for downstream tasks

- Task 005 (executor) consumes `SyncPlan.actions` directly — no further shape translation needed.
- Task 006's `ExtensionsService.describe()` should call `planSync` unchanged (same function, no
  writes) so "what we'd do" and "what we report" can never drift, per this task's own design intent.
