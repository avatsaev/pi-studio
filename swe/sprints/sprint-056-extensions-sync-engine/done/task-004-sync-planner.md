# Task 004 — Pure sync planner (three-way merge, six statuses, zero I/O)

- **Sprint:** sprint-056-extensions-sync-engine
- **Status:** done
- **Type:** feature
- **Area:** packages/server (extensions)
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-002, task-003

## Goal

A single pure function that decides what sync would do and what every entry's status is —
`(manifest, selectedPacks, state, settingsPackages) → SyncPlan` — with no filesystem, no process, and
no clock.

## Context / why

The non-interference guarantee of tenet 1 is entirely encoded here:

- `offered`-as-intent → **sync's only action is installing an identity it has never successfully
  installed before.** Once an identity is in `offered`, no future plan ever contains an action for it.
- `user_removed` / `user_modified` are therefore **terminal, reporting-only** statuses, derived by
  byte-comparing the current `settings.json` entry against `installedSpec`. Any user edit — a version
  pin, switching to the object-filter form, changing a git ref — permanently transfers ownership to
  the user.
- Identities present in `settings.json` but absent from the manifest (the user's own packages) are
  never examined, never reported, never touched.

There is deliberately **no** in-place rewrite path. If a curated package genuinely moves (renamed
upstream, or a `git:` source later published to npm) that is a **new identity**: deprecate the old
entry, add a new one. The earlier draft of this spec had a `source_changed` status for that case; it
was removed because changing a source string always changes the identity, making the status
unreachable.

The scope is deliberately narrow. This module carries the feature's whole correctness argument, so it
must be provable by table-driven unit tests alone — and it is the **one** code path behind both "what
we'd do" (sync) and "what we report" (sprint B's `extensions list`, run in dry-run mode), so the two
can never drift.

## Scope references

- `swe/features/preinstalled-extensions.md` § Planner — pure three-way merge (the pseudocode and the
  load-bearing rule), § RPC surface (`EntryInfo.status` — the six values), § Error Handling
  (user-removed, user-modified, deprecated, fresh-pi-home rows), design tenets 1 and 4
- `packages/server/src/extensions/curated-packs.ts` — `identityOf`, `selectEntries` (task 002)
- `packages/server/src/extensions/extensions-state.ts` — `ExtensionsState` / `PiHomeState` (task 003)
- Create: `packages/server/src/extensions/sync-planner.ts` (+ `.test.ts`)

## What to build

```ts
export type EntryStatus =
  | "installed" | "pending" | "failed"
  | "user_removed" | "user_modified" | "deprecated";

export interface PlannedEntry {
  identity: string;
  pack: string;
  source: string;
  addedIn: string;
  deprecated?: boolean;
  status: EntryStatus;
}
export interface SyncPlan {
  actions: { identity: string; pack: string; source: string }[];  // installs, in manifest order
  entries: PlannedEntry[];                                        // every selected entry, incl. no-action ones
}

export function planSync(input: {
  catalog: CuratedPackCatalog;
  packs: readonly string[];                    // selected slugs; `core` implicit
  state: PiHomeState | "unreadable";           // per-pi-home slice, or the corrupt fail-safe
  settingsPackages: readonly unknown[];        // pi's settings.json `packages` array, string|object entries
}): SyncPlan;
```

Per-entry logic, exactly the spec's pseudocode:

1. `deprecated` → `{ status: "deprecated" }`, **no action, ever** (checked first, so an already-offered
   deprecated entry cannot produce one either).
2. not in `offered` → `{ status: "pending", action: install(source) }`.
3. in `offered`, absent from settings → `user_removed` (final).
4. in `offered`, present but not byte-identical to `installedSpec` → `user_modified` (final).
5. otherwise → `installed`.

`failed` is not produced by rule-matching: an entry that is `pending` **and** has a `failures[identity]`
record reports `failed` (with the action still planned — a failure record never blocks a retry; it is
diagnostics, not state machine).

`settingsPackages` entries come in **string or object form**; `findByIdentity` must match both, and
the byte-compare treats an object form as ≠ the string `installedSpec` (that is exactly the
"user switched to filters" case). Never mutate the input array.

`state === "unreadable"` applies the fail-safe: plan **zero** actions. (Statuses in that mode are
unreliable by design — assert only the empty action list.)

## Out of scope

- Reading `settings.json` or the state file (task 003 owns the store; task 006 owns the settings read).
- Spawning anything (task 005).
- Mapping `PlannedEntry` onto the wire `EntryInfo` (sprint B).

## Acceptance criteria

- [ ] Fresh state, default selection ⇒ five `pending` entries and five actions, in manifest order.
- [ ] Every entry already in `offered` with a byte-identical settings entry ⇒ zero actions, all
      `installed` (the steady state that makes a normal boot a no-op).
- [ ] Offered + absent from settings ⇒ `user_removed`, **no action** (a `pi remove` sticks forever).
- [ ] Offered + settings entry differing by a version pin ⇒ `user_modified`, no action.
- [ ] Offered + settings entry in **object form** ⇒ `user_modified`, no action.
- [ ] `deprecated: true` ⇒ `deprecated` and no action, in **both** cases: never offered, and already
      offered-and-installed.
- [ ] A `pending` entry with a `failures` record ⇒ `status: "failed"` **and** its action is still
      planned (retry is unconditional).
- [ ] Identities in `settingsPackages` that are not in the manifest never appear in `entries` and
      never affect any status.
- [ ] `state: "unreadable"` ⇒ zero actions.
- [ ] Unknown selected slug ⇒ ignored (its entries simply absent); `core` is always included even
      when `packs` is empty or omits it.
- [ ] The function performs **no** I/O: the test file imports no `node:fs`, and passes fixture objects
      only.

## Test / verification plan

- Build: `npm run build:server` succeeds.
- Typecheck: `npm run typecheck` succeeds.
- Lint/format: `npx oxlint <changed files>`, `npx oxfmt --check <changed files>` clean.
- Tests: create `packages/server/src/extensions/sync-planner.test.ts` — table-driven, one case per
  branch above plus the combinations named in the criteria; run
  `npx vitest run packages/server/src/extensions`; all pass.

## Notes

- Keep the module free of any `Logger`, clock, or config type — its purity is what lets task 006 reuse
  it verbatim for dry-run status reporting, and sprint B reuse it again for `extensions list`.
- Use a fixture catalog for most cases (not `CURATED_PACKS`) so the tests do not churn when the real
  manifest gains entries; add one case that asserts against the real catalog's five entries.
