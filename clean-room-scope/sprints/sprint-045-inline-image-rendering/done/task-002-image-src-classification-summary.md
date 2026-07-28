# Task 002 — Shared workspace-path resolver + `classifyImageSrc` (pure, no UI) — Summary

- **Sprint:** sprint-045-inline-image-rendering
- **Completed:** 2026-07-28
- **Status:** done

## What was implemented
- `packages/web-client/src/lib/paths.ts` (new): `resolveWorkspacePath(path, base)`, the shared
  relative-path-plus-base joiner. It is the file tab live-refresh hook's own resolver relocated
  verbatim (same behavior: empty path → `null`; `/`- or `~`-prefixed → returned as-is; otherwise
  `base` with trailing slashes collapsed, joined with `/`; empty `base` → `null`) — no logic change,
  just a new home shared by a second consumer.
- `packages/web-client/src/hooks/use-file-live-refresh.ts` now imports `resolveWorkspacePath` from
  `lib/paths.ts` instead of defining it locally; its test file keeps only the `LIVE_REFRESH_KINDS`
  cases, the join/trailing-slash cases moved to `lib/paths.test.ts`.
- `packages/web-client/src/timeline/image-src.ts` (new): `classifyImageSrc(src, base, homeDir)`, the
  pure decision function from the scope's classification table, applied in the documented order:
  empty/whitespace → unresolvable; `http:`/`https:`/`data:`/`blob:` → remote; any other `scheme:`
  (including `file:`) → unresolvable; `/…` → local as-is; `~`/`~/…` → expanded via `normalizeCwd`
  against a known `homeDir` (unresolvable if unknown); `./…`/`../…`/bare relative → joined via
  `resolveWorkspacePath` against `base` (unresolvable with no base); final gate —
  `detectViewerKind(candidate) !== "image"` → unresolvable. A `#fragment`/`?query` suffix is stripped
  before classification.
- No React, hook, or network imports in `image-src.ts` — only `resolveWorkspacePath`,
  `normalizeCwd` (`features/sessions/workspace-grouping.ts`), and `detectViewerKind`
  (`features/files/viewer-registry.ts`), all pure.

## Files created / changed
| File | Change |
|------|--------|
| `packages/web-client/src/lib/paths.ts` | created — `resolveWorkspacePath` |
| `packages/web-client/src/lib/paths.test.ts` | created — the migrated join/trailing-slash cases |
| `packages/web-client/src/timeline/image-src.ts` | created — `classifyImageSrc` |
| `packages/web-client/src/timeline/image-src.test.ts` | created — one case per classification-table row plus query/fragment/webp/svg cases |
| `packages/web-client/src/hooks/use-file-live-refresh.ts` | modified — imports `resolveWorkspacePath`; local `watchTargetPath` removed |
| `packages/web-client/src/hooks/use-file-live-refresh.test.ts` | modified — trimmed to `LIVE_REFRESH_KINDS` cases only |

## How it satisfies the scope
- `clean-room-scope/features/inline-image-rendering.md` § Public Contract → Markdown image source
  classification: every row of the table is covered 1:1 by a test; the relative-path join explicitly
  reuses the lifted resolver rather than a second implementation, per that section's own instruction.
- § Asset base: `classifyImageSrc` takes `base: string | null` and `homeDir: string | null` exactly as
  specified — "with no asset base, absolute and `~` paths still resolve; only relative paths degrade
  to unresolvable" is covered by the "absolute path with no asset base" and "relative path with no
  asset base" tests.
- `clean-room-scope/features/timeline-rendering.md` § Markdown feature support: no change needed here
  yet — this task is the pure decision layer only; wiring into the markdown renderer is task-004.

## Build & test results
```
$ npx vitest run packages/web-client/src/lib/paths.test.ts packages/web-client/src/timeline/image-src.test.ts packages/web-client/src/hooks/use-file-live-refresh.test.ts
 Test Files  3 passed (3)
      Tests  31 passed (31)

$ npm run build:web-client
✓ built in 8.52s   (pre-existing "circular chunk"/chunk-size warnings, unrelated to this change)

$ npx tsc -b packages/web-client   (via build:web-client)
(clean exit, no errors)
```

## Acceptance criteria
- [x] `resolveWorkspacePath` lives in `lib/paths.ts`; `use-file-live-refresh.ts` imports it and no
      copy of the join logic remains — `grep -c watchTargetPath packages/web-client/src` returns 0
      (verified; the old name does not appear anywhere, including comments).
- [x] `classifyImageSrc` returns the scope table's result for every row, including `file:` →
      `unresolvable` and `~` with an unknown home dir → `unresolvable` — 23 tests, one (or more) per
      row.
- [x] `![](notes.pdf)`-shaped input classifies `unresolvable` — verified directly.
- [x] `./shot.png` with `base: null` → `unresolvable`; with a base → `local` with the joined
      (non-normalized, exactly as `resolveWorkspacePath` produces) path.
- [x] `shot.png?v=2` and `shot.png#frag` still classify as `local` images.
- [x] `npm run build:web-client` and `npm run typecheck` pass.

## Follow-ups / TODO(verify)
- Extension admission pinned by test: the viewer registry's `EXT_TO_VIEWER` (`viewer-registry.ts`)
  classifies **both** `.webp` and `.svg` as `"image"` — neither needed special-casing in
  `classifyImageSrc`; both are covered by dedicated tests per the task's own instruction to record the
  answer.
- Relative-path joins are not filesystem-normalized (a `../` segment is preserved literally in the
  joined path, matching `resolveWorkspacePath`'s pre-existing, unchanged behavior) — not a regression,
  just documented here since the task's example test needed the un-normalized form to pass.
