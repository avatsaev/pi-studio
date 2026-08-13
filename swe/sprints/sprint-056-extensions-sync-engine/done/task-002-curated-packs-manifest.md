# Task 002 — Curated-packs manifest, source parsing, and the guard test

- **Sprint:** sprint-056-extensions-sync-engine
- **Status:** done
- **Type:** feature + docs
- **Area:** packages/server (extensions)
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** none

## Goal

Land the single source of truth for what Pi-Studio recommends — a typed, unpinned, append-only
manifest — plus source-parsing/identity helpers and a guard test that makes the "user owns versions"
tenet mechanically unbreakable.

## Context / why

Everything else in this sprint reads this module. It is **pure data plus two tiny pure functions**,
so it can be built and tested with no I/O, no pi, and no daemon.

The guard test is the load-bearing part. Sources must stay **unpinned** because `pi update` skips
pinned npm specs (`updateConfiguredSources`: `if (!parsed.pinned)`, pi 0.84.1
`package-manager.js:840`) — a pin written by Pi-Studio would permanently exclude that extension from
the user's own updater and make us the bottleneck for every upstream bug fix. A well-meaning future
"let's freeze this one" edit must fail CI, not ship.

v1 ships **one pack**: `core`, five unpinned npm sources. `core` is implicit and always selected;
`swe`/`science`/`data` are comments only, added later as pure data edits.

## Scope references

- `swe/features/preinstalled-extensions.md` § The manifest (single source of truth) — the full
  manifest, the field table, the five invariants; § How updates actually reach users (why unpinned);
  design tenets 1 and 3
- `packages/web-client/src/theme/token-integrity.test.ts` — the guard-test idiom this mirrors
- `packages/cli/src/update-control.ts:26-30` — the `createRequire(import.meta.url)("../package.json")`
  precedent for reading our own version at runtime
- Create: `packages/server/src/extensions/curated-packs.ts`, `.../curated-packs.test.ts`

## What to build

**1. Types + manifest** in `packages/server/src/extensions/curated-packs.ts`:

```ts
export interface CuratedEntry {
  source: string;              // unpinned pi spec: `npm:<name>` or `git:<url>` — no @version/@ref
  addedIn: string;             // aligned workspace version on disk when the entry was added
  deprecated?: boolean;        // tombstone: never offered anew, existing installs untouched
}
export interface CuratedPack { title: string; description: string; packages: CuratedEntry[] }
export type CuratedPackCatalog = Record<string, CuratedPack>;
export const CURATED_PACKS = { core: { … } } satisfies CuratedPackCatalog;
```

The five `core` entries exactly as listed in the spec (`@99percentpeople/pi-background-tasks`,
`pi-memctx`, `@juicesharp/rpiv-todo`, `pi-web-access`, `pi-powerline-footer`), each with
`addedIn: "0.0.73"` and its one-line purpose comment from the spec. Keep the comments — they are the
product copy a future UI picker and the CLI table lean on.

**2. Pure helpers** in the same module:

```ts
/** Parse a pi source spec. `identity` is pi's dedup key: npm package name, or git URL without ref. */
export function parseSource(source: string): { kind: "npm" | "git"; identity: string; pinned: boolean };
export function identityOf(source: string): string;
/** `core` + the given slugs, deduped, unknown slugs reported for a caller-side `warn`. */
export function selectEntries(
  catalog: CuratedPackCatalog,
  packs: readonly string[],
): { entries: { pack: string; entry: CuratedEntry }[]; unknownSlugs: string[] };
/** Aligned workspace version, read from packages/server/package.json (never the root one). */
export const SERVER_VERSION: string;
```

`SERVER_VERSION` follows the `update-control.ts` precedent — but note this module sits **two** levels
below the package root in both `src/` and `dist/`, so the specifier is `"../../package.json"`.

Git-source parsing must handle pi's own SSH shape (`splitRef`, `dist/utils/git.js:2-17`, matches
`^git@([^:]+):(.+)$` and splits the ref on the first `@` after the colon) so `pinned` is correct for
a `git:` spec even though v1 ships none.

**3. Guard test** `curated-packs.test.ts` enforcing the spec's four manifest invariants, plus the
`selectEntries` helper contract:

- every `source` parses and is **unpinned** — `npm:foo@1.2.3` and `git:…@ref` both rejected;
- no identity appears in more than one pack (disjointness — what makes multi-pack selection safe
  against double-loading);
- pack keys are stable slugs, `core` exists, every `addedIn` is valid semver and `<= SERVER_VERSION`;
- no `source` contains a placeholder (`<ref>`, `<version>`, `<pkg>`);
- `selectEntries` puts `core` first, is order-stable, dedupes, and reports unknown slugs instead of
  throwing.

**4. Security read (release-blocking).** The spec's acceptance criteria gate the first release that
ships the manifest on a security-minded read of each entry — and inclusion time is when it belongs.
Record one short dated note per entry (project + maintainer health, permissions posture;
per-project, not per-version — spec § How updates actually reach users) in
`swe/notes/core-pack-security-read.md`.

## Out of scope

- Config schema, state file, planner, executor, service, bootstrap (tasks 003–006).
- Any protocol/client/CLI surface (sprint B).
- Adding a second pack. `swe`/`science`/`data` stay comments.

## Acceptance criteria

- [ ] `CURATED_PACKS.core.packages` has exactly the five spec'd sources, all `npm:`, all unpinned,
      each with `addedIn: "0.0.73"`.
- [ ] `parseSource` returns `pinned: true` for `npm:foo@1.2.3`, `git:git@github.com:o/r@v1`, and
      `false` for `npm:foo`, `npm:@scope/foo`, `git:git@github.com:o/r`; `identity` strips the ref
      and is stable across those forms.
- [ ] `identityOf("npm:@scope/foo") === "@scope/foo"` (scoped names are not split on their `@`).
- [ ] The guard test **fails** when a pinned source, a duplicate identity across packs, a
      placeholder, a bad-semver `addedIn`, or an `addedIn` above `SERVER_VERSION` is introduced —
      asserted by feeding the invariant checks a deliberately broken fixture catalog, not by editing
      the real manifest.
- [ ] `SERVER_VERSION` matches `packages/server/package.json`'s version at runtime from both `src/`
      (vitest) and the compiled `dist/` layout; it is never read from the root `package.json`.
- [ ] `selectEntries(CURATED_PACKS, [])` yields the five `core` entries; `selectEntries(…, ["nope"])`
      yields the same plus `unknownSlugs: ["nope"]` and does not throw.
- [ ] `swe/notes/core-pack-security-read.md` exists with a dated note for each of the five entries,
      so the release-blocking spec criterion has an auditable artifact.

## Test / verification plan

- Build: `npm run build:server` succeeds.
- Typecheck: `npm run typecheck` succeeds.
- Lint/format: `npx oxlint <changed files>`, `npx oxfmt --check <changed files>` clean.
- Tests: create `packages/server/src/extensions/curated-packs.test.ts`; run
  `npx vitest run packages/server/src/extensions`; all pass.
- Confirm the compiled path resolution: after `npm run build:server`, assert
  `node -e` (or a test importing from `dist/`) reads the version successfully — the `"../../"`
  specifier is the easiest thing in this task to get wrong.

## Notes

- Entries are **never deleted** from the manifest (append-only, same idiom as the wire protocol) —
  retire with `deprecated: true`.
- `addedIn` is stamped with the version **currently on disk** (`0.0.73`) and ships in the following
  release; that is what keeps the `<= SERVER_VERSION` invariant green between the curation edit and
  the release bump. Do not stamp a future version.
- The earlier draft's `@juicesharp/rpiv-ask-user-question` and `@luxusai/pi-hindsight` are **not** in
  the manifest and must not be added back here. They were cut pre-ship (spec § TODO(verify), final
  item), so they are absent outright — do **not** carry them as `deprecated: true` tombstones, which
  would leave dead data and a permanent `deprecated` row in the CLI table for entries no user ever
  received. This also resolves the earlier concern that `pi-memctx` and `pi-hindsight` would ship two
  competing long-term-memory toolsets to every agent: only `pi-memctx` ships now.
