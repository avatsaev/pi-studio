# Task 001 — Shared path-resolution fix + `classifyFileLinkSrc`

- **Sprint:** sprint-051-file-link-rendering
- **Status:** done
- **Estimated size:** M
- **Depends on:** none

## Goal
Extract the candidate-resolution step `classifyImageSrc` already performs into one shared function
both classifiers call, fixing two gaps found while reviewing `file-link-rendering.md` — missing
path normalization and missing percent-decoding — then implement `classifyFileLinkSrc` on top of
it per the spec's two-way classification table.

## Background / why
`classifyImageSrc` (`packages/web-client/src/timeline/image-src.ts`, sprint-045) already strips
`#fragment`/`?query` (`image-src.ts:47-50`, `split(/[?#]/, 1)`), detects schemes (`SCHEME_RE`),
passes `/`-absolute through, expands `~` via `normalizeCwd`, and joins relatives via `lib/paths.ts`'s
`resolveWorkspacePath` — the helper sprint-045 lifted out **specifically so a second copy would
never exist** (see its doc comment). What it does NOT do is normalize or percent-decode the result:
`classifyImageSrc("./shot.png", "/repo", "/home/bob")` returns `/repo/./shot.png` today
(`image-src.test.ts:78-89`), and `my%20notes.md` stays encoded. Harmless for images — nothing
compared two image paths for equality — but `file-link-rendering.md` § Markdown link source
classification makes both properties **contractual for both classifiers**, because a file link's
tab identity is `file:<absolute path>` matched by exact string (`workspace-split-panes.md` § Tab
identity): an unnormalized `/repo/./notes.md` from `[notes](./notes.md)` would never match the
`file:/repo/notes.md` tab a Files-tree open already minted, silently breaking every tab-reuse
acceptance criterion this feature needs.

`classifyFileLinkSrc` itself is a **two-way** split (`local`/`external`), simpler than
`classifyImageSrc`'s three-way one: no extension gate, any local path qualifies (including a
directory), and anything that isn't a local candidate is `external` outright — never a degraded
fallback, since a non-file `href` may be a genuinely working link. The only per-classifier
divergences: a fragment-**only** href (`#section`) maps to `external` (image maps the resulting
empty candidate to `unresolvable`), and the extension gate stays image-only.

## Scope references
- `clean-room-scope/features/file-link-rendering.md` § Markdown link source classification
- `clean-room-scope/features/inline-image-rendering.md` § Markdown image source classification
- `packages/web-client/src/lib/paths.ts` (`resolveWorkspacePath` — the existing join seam; gains
  the dot-segment collapser)
- `packages/web-client/src/timeline/image-src.ts` (shared-step extraction source + refactor target)
- `packages/web-client/src/timeline/image-src.test.ts`,
  `packages/web-client/src/timeline/markdown.test.ts` (expectations change — see below)

## What to build
- `lib/paths.ts`: add a pure, exported dot-segment collapser, e.g.
  `collapseDotSegments(path: string): string` — lexically resolves `.`/`..` segments in an absolute
  path (no filesystem access). `resolveWorkspacePath` itself stays byte-identical for its existing
  consumers; the collapser is applied by the classifiers' shared step below.
- `timeline/` (new small module, e.g. `href-resolution.ts`): extract the candidate-resolution step
  currently inline in `classifyImageSrc` — the `[?#]` strip, `SCHEME_RE` detection, `/`-absolute
  pass-through, `~` expansion via `normalizeCwd`, relative join via `resolveWorkspacePath` — into
  one shared function both classifiers call. It MUST delegate to `resolveWorkspacePath`/
  `normalizeCwd`, never reimplement the join (that duplication is exactly what `lib/paths.ts`'s doc
  comment forbids). The shared step **percent-decodes** the resolved local candidate and applies
  `collapseDotSegments` to it. Percent-decoding lives HERE and not in `lib/paths.ts` deliberately:
  explorer/live-refresh paths can legitimately contain a literal `%20` in a filename — decoding is
  a markdown-href concern only.
- Refactor `image-src.ts`'s `classifyImageSrc` onto the shared step, keeping its own three-way
  shape, its fragment-only→`unresolvable` outcome, and the `detectViewerKind` extension gate on
  top. Intentional behavior change: `local` results become normalized and percent-decoded. Update
  `image-src.test.ts` and `markdown.test.ts` expectations to match (e.g. `./shot.png` against
  `/repo` now expects `/repo/shot.png`, not `/repo/./shot.png`).
- New `packages/web-client/src/timeline/file-link-src.ts`:
  ```ts
  export type FileLinkClassification = { kind: "local"; path: string } | { kind: "external" };
  export function classifyFileLinkSrc(
    href: string,
    base: string | null,
    homeDir: string | null,
  ): FileLinkClassification;
  ```
  Empty/whitespace → `external`; fragment-only (`#section`) → `external`; a path with a trailing
  `#fragment` (`README.md#usage`) → fragment stripped by the shared step, remainder classifies
  normally (the anchor is discarded — no heading/line targeting); any explicit `scheme:` →
  `external`; otherwise the shared step's `local` → `local`, anything unresolved → `external`.
- New `packages/web-client/src/timeline/file-link-src.test.ts` covering every row of the
  classification table plus fragment-stripping, percent-decoding, and normalization; plus a
  `lib/paths.ts` test for `collapseDotSegments` alongside any existing paths tests.

## Out of scope
- Wiring `classifyFileLinkSrc` into the markdown renderer (task-003).
- Any change to `classifyImageSrc`'s public shape (`local`/`remote`/`unresolvable`) — only its
  `local.path` value changes.
- Changing `resolveWorkspacePath`'s own output for non-classifier consumers
  (`use-file-live-refresh`) — if normalizing those too turns out desirable, that is a separate,
  deliberate follow-up, not a side effect of this task.

## Acceptance criteria
- [ ] `classifyFileLinkSrc` is unit-tested across every table row: empty/whitespace, fragment-only,
      path+fragment, `http:`/`https:`, another explicit scheme, `/`-absolute, `~`-prefixed (home dir
      known and unknown), `./`/`../`/bare-relative (base present and absent).
- [ ] `classifyFileLinkSrc("./notes.md", "/repo", null)` and
      `classifyFileLinkSrc("../x/../notes.md", "/repo/a", null)` both return
      `{ kind: "local", path: "/repo/notes.md" }` (normalization).
- [ ] `classifyFileLinkSrc("my%20notes.md", "/repo", null)` returns
      `{ kind: "local", path: "/repo/my notes.md" }` (percent-decoding).
- [ ] `classifyImageSrc("./shot.png", "/repo", "/home/bob")` now returns
      `{ kind: "local", path: "/repo/shot.png" }`, and `classifyImageSrc("my%20shot.png", "/repo",
      "/home/bob")` decodes — existing test expectations updated, not left failing; every other
      image case (remote schemes, extension gate, fragment-only → unresolvable) unchanged.
- [ ] A directory-shaped local path still classifies `local` under `classifyFileLinkSrc` — no
      extension gate on this classifier.
- [ ] The shared step contains no join/tilde logic of its own — grep confirms the only join is
      `resolveWorkspacePath` and the only `~` expansion is `normalizeCwd`.
- [ ] `npm run build` and `npm run typecheck` pass.

## Test / verification plan
- Unit: `packages/web-client/src/timeline/file-link-src.test.ts` (new), covering the table above.
- Unit: `packages/web-client/src/timeline/image-src.test.ts` and `markdown.test.ts` — update the
  `./`/`../`-prefixed expectations to normalized paths; add a decode case; all others unchanged.
- Run: `npx vitest run packages/web-client/src/timeline packages/web-client/src/lib`.

## Notes
Percent-decoding uses `decodeURIComponent` semantics but must not throw on malformed sequences
(`%E0%`) — a candidate that fails to decode keeps its raw form rather than crashing the classifier.
