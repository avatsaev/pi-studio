# Task 001 — Pure asset-ref extraction, confinement and rewriting — Summary

- **Sprint:** sprint-064-html-preview-local-assets
- **Completed:** 2026-08-19T12:46Z
- **Status:** done

## What was implemented

`packages/web-client/src/features/files/html-assets.ts` — new pure, DOM-free module:

- `AssetRef` / `ConfinedRef` types.
- `ASSET_LIMITS` (64 assets / 2 MiB per asset / 16 MiB total) and `withinAssetCaps(countSoFar,
  totalBytesSoFar, candidateBytes)` — the single pure cap predicate task-002's loader will drive
  as bytes arrive.
- `confinementRoot(docDir, workspaceRoot, homeDir)` — narrows to `docDir` when the workspace root
  is the home directory itself.
- `confineAssetRef(raw, docDir, root, context, homeDir?)` — the security gate: percent-decode once
  (non-throwing) → resolve (absolute/`~`/relative) → `collapseDotSegments` → segment-aware root
  check (`path === root || path.startsWith(root + "/")`).
- `extractLocalAssetRefs(source)` — regex-based tag/attribute scanner (`<link rel=stylesheet
  href>`, `<script src>`, `<img src|srcset>`, `<source src|srcset>`, `<video src|poster>`,
  `<audio src>`), de-duplicated, first-occurrence order, pre-filtering scheme/protocol-relative/
  fragment/empty refs.
- `rewriteHtmlAssetRefs(source, assets)` — the tag/attribute-scoped rewrite that replaces
  `assembleHtmlPreview`'s old whole-document exact-value substitution (see Deviation 1 below);
  handles `srcset` per-candidate substitution with descriptor preservation.
- `extractCssUrlRefs(css)` / `rewriteCssUrls(css, assets)` — the CSS-side counterpart for a
  stylesheet's own `url(...)` references (one nested level, per task-002); labels a ref inside an
  `@font-face` block `"font"`, everything else `"image"` (see Deviation 2).
- `mimeForAssetPath(path)` (client-side extension → MIME map covering css/js/html/image/video/
  audio/font — the daemon's own map has none of these) and `dataUri(mimeType, bytes)`
  (chunked-base64 `btoa`, no `Buffer`).

`packages/web-client/src/timeline/href-resolution.ts` — exported `SCHEME_RE` and `percentDecode`
(previously module-private) so `html-assets.ts` reuses the identical scheme test and non-throwing
decode rather than forking a second copy, per the task's explicit instruction and `lib/paths.ts`'s
existing no-second-copy convention. No behavior change for existing consumers.

`packages/web-client/src/features/files/html-sandbox.ts` — `assembleHtmlPreview` now calls
`rewriteHtmlAssetRefs` from `html-assets.ts` instead of its old local `substituteAssets` (removed,
clean cutover — no caller left on the old function).

## Deviations from the task's literal code sample (both necessary, both tested)

1. **`rewriteHtmlAssetRefs` is a new export, not an extension of the old `substituteAssets`.** The
   old function did a whole-document, tag-blind exact-attribute-value match — incapable of
   correctly rewriting one URL inside a multi-candidate `srcset` value (a mandatory test case: the
   whole `srcset` string never equals a single asset key). The new function reuses
   `extractLocalAssetRefs`'s own tag/attribute scanner so extraction and rewriting can never
   diverge on which contexts count, and additionally **narrows scope**: only the specific
   tag/attribute pairs `extractLocalAssetRefs` scans are rewritten (an existing sprint-063 test
   asserted the old, broader "any attribute value" behavior — updated in this task, see below).
2. **`confineAssetRef` gained a 5th `homeDir: string | null = null` parameter**, absent from the
   task file's abbreviated code sample. Without it, a `~`-prefixed ref *authored inside the HTML
   document itself* (`src="~/logo.png"`) can never resolve to the same absolute form as an already
   -expanded confinement root, so the task's own acceptance test ("`~`-prefixed refs" accepted)
   would be unsatisfiable. `resolveWorkspacePath` deliberately leaves `~` unexpanded (daemon-side
   expansion, per root `AGENTS.md` invariant 7); `confineAssetRef` reuses the same `normalizeCwd`
   every other tilde-workspace consumer uses, defaulting to `null` (skip as `"unsupported"`) when
   no home directory is known.
3. **`extractCssUrlRefs` is an added export**, not in the task's literal list. `rewriteCssUrls`
   (asked for) rewrites already-known refs but cannot itself discover what to fetch; without this,
   task-002's loader would need its own CSS `url()` regex, forking the exact rule this module
   exists to centralize. Kept inside task-001's own "pure extraction" charter (no fetching, no
   React) rather than deferred to task-002.
4. **`withinAssetCaps` is an added export**, satisfying the task's own instruction ("enforced by a
   pure predicate the tests drive") which named no function.

## Existing test updated (sprint-063, `html-sandbox.test.ts`)

Two tests in `assembleHtmlPreview — asset substitution` asserted the *old* naive-substitution
behavior and now fail against the correct one — updated, not deleted:

- `"substitutes a supplied asset ref only inside a quoted attribute value"` → renamed
  `"...only inside a scanned attribute context"`; no longer expects `alt="..."` to be rewritten
  (that assertion documented the old blind-match limitation, not a real requirement — `alt` is not
  a scanned context).
- `"supports single-quoted attribute values"` → updated to expect the *output* is always
  double-quoted (the new rewrite always emits double quotes regardless of source quote style, since
  an unquoted value must be upgraded to quoted when substituting a `data:` URI, and using one
  consistent quote style everywhere is simpler and cannot mis-escape).

## Files changed

- `packages/web-client/src/features/files/html-assets.ts` (new)
- `packages/web-client/src/features/files/html-assets.test.ts` (new, 63 tests)
- `packages/web-client/src/features/files/html-sandbox.ts` (edited: `assembleHtmlPreview` now
  delegates rewriting to `html-assets.ts`; old `substituteAssets` removed)
- `packages/web-client/src/features/files/html-sandbox.test.ts` (edited: 2 tests updated to match
  the tightened, tag/attribute-scoped rewrite)
- `packages/web-client/src/timeline/href-resolution.ts` (edited: `SCHEME_RE`/`percentDecode`
  exported, no behavior change)

## Commands run + results

- `npx tsc -b packages/web-client --force` → clean, exit 0.
- `npx vitest run packages/web-client/src/features/files packages/web-client/src/timeline
  packages/web-client/src/hooks` → 30 files, 433 tests, all passing (node environment, no jsdom).
- `npm run build:web-client` → clean, exit 0 (pre-existing >500 kB chunk-size warnings only,
  unrelated to this task).
- `npx oxlint` / `npx oxfmt --check` on every touched file → clean (one lint pass surfaced 3
  `unicorn/no-array-sort` warnings in the new test file — fixed to `.toSorted()`).

## Acceptance criteria

- [x] `extractLocalAssetRefs` finds every scanned context in a realistic fixture, no false
      positives from text/`data:`/absolute-remote refs.
- [x] `confineAssetRef` rejects every out-of-root form (`..`, `%2e%2e%2f`, `%2F`-encoded
      separators, sibling-directory string-prefix) and accepts in-root relative/absolute/`~` forms;
      decode-before-normalize order verified by the `%2F`-smuggling test.
- [x] `confinementRoot` narrows to `docDir` for a home-rooted workspace, passes the workspace root
      through otherwise.
- [x] Caps expressed once in `ASSET_LIMITS`, enforced by the pure `withinAssetCaps` predicate,
      test-driven.
- [x] `assembleHtmlPreview` substitutes a supplied asset map inside attribute values only; a ref
      appearing as document text is untouched.
- [x] Every test runs in the node environment with no DOM (no jsdom added).
- [x] `npm run build:web-client` and `npm run typecheck` pass.

## Follow-ups / TODO(verify) for task-002

- None new. Task-002 fetches confined refs over `transferFor(daemon).download(path)`, builds the
  `assets: Record<raw, dataUri>` map via `dataUri`/`mimeForAssetPath`, runs a second
  `extractCssUrlRefs`/`rewriteCssUrls` pass over each inlined stylesheet, and hands the map to
  `assembleHtmlPreview` (already wired through `rewriteHtmlAssetRefs` in this task).
