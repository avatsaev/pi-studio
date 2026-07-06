# Task 001 — Full diff viewer with syntax highlighting & scroll sync — Summary

- **Sprint:** sprint-027-git-full
- **Completed:** 2026-07-06
- **Status:** done

## What was implemented

The production diff viewer: unified + side-by-side (split) rendering with
syntax highlighting, word-level diff highlighting, collapsed unchanged ranges,
binary/too-large placeholders, scroll-to-change navigation, and copy-hunk — as a
pure, fully-tested model (`panels/diff-viewer.ts`) plus a thin React renderer
(`components/panels/DiffViewer.tsx`).

1. **Word-level diff (`computeWordDiff`).** LCS over word/whitespace/punctuation
   tokens (`tokenizeWords`) producing per-side segment streams (`equal|remove`
   for old, `equal|add` for new). Segments are coalesced. "hello world" →
   "hello earth" highlights only `world`/`earth`.

2. **Unified rows (`buildUnifiedRows`).** Emits `hunk-header`, `collapsed`, and
   `line` rows with old/new gutters, sign, word segments on paired change lines,
   and an `isChange` flag. Long context runs collapse to `edge` visible lines per
   side + a "… N lines hidden" marker.

3. **Split rows (`buildSplitRows`).** Pairs consecutive removed/added lines into
   aligned left/right cells; unbalanced blocks pad the short side with `blank`
   cells. Context lines mirror on both columns. Same collapse behavior. The
   component scroll-locks the columns (single shared scroll container).

4. **Placeholders (`diffPlaceholder`).** `isBinary` → "Binary file, N bytes" (no
   diff); `tooLarge` or `byteSize > 500 KB` (`TOO_LARGE_BYTES`) → "File too large
   to diff" with a "Show anyway" affordance (`forceShow`).

5. **Scroll-to-change (`changeRowIndices` / `nextChangeIndex` /
   `prevChangeIndex`).** Change-row index list with wraparound next/prev; the
   component scrolls the target row into view and highlights it.

6. **Copy hunk (`hunkToText`).** Reconstructs a unified-diff text block with
   `+`/`-`/space prefixes; the component's hunk-header copy button writes it to
   the clipboard.

7. **Component wiring.** `DiffViewer` takes a `DiffInput` (compatible with the
   `GitDiff` projection from `useGitDiff`), a `layout`, a `language` hint
   (defaults to the file extension), and a `wrap` toggle. Lines are
   syntax-highlighted via `highlightCode` + `tokenColorVar` (from sprint-026),
   with word-diff overlays taking precedence on changed lines.

## Files created / changed

| File | Change |
|------|--------|
| `packages/app/src/panels/diff-viewer.ts` | created (pure model) |
| `packages/app/src/panels/diff-viewer.test.ts` | created (13 tests) |
| `packages/app/src/panels/index.ts` | modified (export diff-viewer) |
| `packages/app/src/components/panels/DiffViewer.tsx` | created |
| `packages/app/src/components/panels/DiffViewer.module.css` | created |
| `packages/app/src/components/panels/index.ts` | modified (export DiffViewer) |

## How it satisfies the scope

- **feature-panels-ui.md § Body** — unified = gutter + code column, tokenized +
  syntax-highlighted, wrap toggle; split = two columns with a divider, header
  rows span full width; add/remove/context/header line colors. `binary` /
  `too_large` placeholders.
- **task-001 acceptance** — unified with gutters + highlighting + collapsed
  ranges; split with synchronized columns + alignment; word-level highlighting;
  binary/too-large placeholders; scroll-to-change navigation; copy hunk.
- Integrates with `useGitDiff(serverId, cwd, filePath)` — the returned `GitDiff`
  (`filePath`, `hunks`, `isBinary`, `tooLarge`, `kind`) is structurally the
  `DiffInput` the viewer consumes.

### Deviations / boundaries
- **Split scroll sync** is achieved by rendering both columns inside one shared
  vertical scroll container (rows are full-width flex rows), so the columns are
  inherently locked — no separate scroll listeners needed. Horizontal per-column
  scroll for very long lines is left to the wrap toggle / native overflow.
- Row virtualization is not applied in this component (the sprint-021 virtualized
  timeline covers the large-list case); diffs collapse long context runs to keep
  row counts bounded. TODO(verify) if extremely large diffs need windowing here.
- The component is a thin renderer over the tested pure model; not render-tested
  (node-only env, consistent with the suite). All row/segment/placeholder logic
  is unit-tested.

## Build & test results

```
$ npx tsc -b packages/app
(clean)

$ npx vitest run packages/app/src/panels/diff-viewer.test.ts
 Test Files  1 passed (1)
      Tests  13 passed (13)

$ npm run build
(clean)

$ npm test
 Test Files  128 passed (128)
      Tests  1621 passed (1621)
```

## Acceptance criteria
- [x] Unified mode renders with gutters, syntax highlighting, and collapsed
      unchanged ranges — `buildUnifiedRows` + `collapseRuns` (diff-viewer.test.ts).
- [x] Split mode renders two synchronized columns with alignment —
      `buildSplitRows` (blank-cell padding test) + shared-scroll component.
- [x] Word-level highlighting shows within changed lines — `computeWordDiff`
      ("world"→"earth" test) + `wordSegments` on rows.
- [x] Binary/too-large files show appropriate placeholders — `diffPlaceholder`
      (binary + too_large + show-anyway tests).
- [x] Scroll-to-change navigates between hunks — `changeRowIndices` /
      `nextChangeIndex` / `prevChangeIndex` (wraparound test).

## Follow-ups / TODO(verify)
- Row windowing for pathologically large diffs (currently bounded by context
  collapse).
- Confirm the daemon's `checkout_diff_request` populates `byteSize` for the
  auto too-large detection (falls back to the `tooLarge` flag otherwise).
