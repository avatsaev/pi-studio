# Task 002 — Summary

- **Sprint:** sprint-056-extensions-sync-engine
- **Status:** done

## What was built

- `packages/server/src/extensions/curated-packs.ts` — the manifest (`CURATED_PACKS`, one pack
  `core` with the five spec'd unpinned npm sources), `CuratedEntry`/`CuratedPack`/
  `CuratedPackCatalog` types, `SERVER_VERSION` (read via `createRequire(import.meta.url)
  ("../../package.json")`, resolving `packages/server/package.json` from both `src/` and compiled
  `dist/`), `parseSource`/`identityOf` (npm scoped-name-safe, git scp-like/URL/bare-form ref
  splitting mirroring pi's own `splitRef`), `selectEntries` (core-first, order-stable, identity
  deduped, unknown-slug reporting), and `checkCatalogInvariants` — a reusable violation-collecting
  function backing the guard test (parses + unpinned, disjoint identities across packs, stable pack
  slugs with `core` required, valid semver `addedIn <= currentVersion`, no placeholders).
- `packages/server/src/extensions/curated-packs.test.ts` — 20 tests: manifest content assertions,
  `SERVER_VERSION` resolution from both `src/` and compiled `dist/` (the latter self-skips if
  `npm run build:server` hasn't run yet, and was confirmed green after building — see below),
  `parseSource`/`identityOf` behavior including the scoped-package and git-ref edge cases, and the
  guard test proper: `checkCatalogInvariants(CURATED_PACKS)` is clean, and each invariant is proven
  to actually reject a deliberately broken **fixture** catalog (pinned npm, pinned git, duplicate
  identity across packs, placeholder, bad-semver `addedIn`, future-dated `addedIn`, missing `core`)
  — never by editing the real manifest.
- `swe/notes/core-pack-security-read.md` — dated per-entry security note for all five `core`
  packages (project + maintainer health, permissions posture), satisfying the release-blocking
  acceptance criterion.

## Test / verification results

- `npx vitest run packages/server/src/extensions` — 2 files, 21 tests, **pass** (20 in
  `curated-packs.test.ts`, 1 pre-existing from task-001).
- `npm run build:server` — pass; re-ran the suite afterward to confirm the dist-resolution test
  exercises the real compiled path (not just its build-order-tolerant skip branch) — still green.
- `npm run typecheck` — pass.
- `npx oxlint packages/server/src/extensions` — clean.
- `npx oxfmt --check packages/server/src/extensions/curated-packs.ts
  packages/server/src/extensions/curated-packs.test.ts` — clean (one auto-fix pass with scoped
  `npx oxfmt <files>`, no project-wide reformat).

## Acceptance criteria

- [x] `CURATED_PACKS.core.packages` has exactly the five spec'd sources, all `npm:`, all unpinned,
      each with `addedIn: "0.0.73"`.
- [x] `parseSource` returns `pinned: true`/`false` correctly for the npm/git pinned/unpinned forms
      named in the spec; `identity` strips the ref/version and is stable across those forms.
- [x] `identityOf("npm:@scope/foo") === "@scope/foo"` (scoped names not split on their own `@`).
- [x] The guard test fails when a pinned source, a duplicate identity, a placeholder, a bad-semver
      `addedIn`, or a future-dated `addedIn` is introduced — via fixture catalogs, real manifest
      untouched.
- [x] `SERVER_VERSION` matches `packages/server/package.json`'s version at runtime from both `src/`
      and compiled `dist/`; never read from the root `package.json` (asserted the root has no
      `version` field at all).
- [x] `selectEntries(CURATED_PACKS, [])` yields the five `core` entries;
      `selectEntries(…, ["nope"])` yields the same plus `unknownSlugs: ["nope"]`, no throw.
- [x] `swe/notes/core-pack-security-read.md` exists with a dated note for each of the five entries.

## Notes for downstream tasks

- `checkCatalogInvariants` is exported (not just an internal test helper) — task 004/005/006 do not
  need it, but it is available if a future RPC surface (sprint B) wants to validate a config-supplied
  pack selection against catalog shape.
- No second pack was added; `swe`/`science`/`data` remain absent (not even comments were needed —
  the real spec text already documents them as future work).
