# Task 001 — Descriptor-driven viewer registry + `ViewerProps.workspaceCwd` — Summary

- **Sprint:** sprint-063-html-file-preview
- **Completed:** 2026-08-19T11:08:52Z
- **Status:** done

## What was implemented

Collapsed the viewer registry's four parallel registration sites (EXT_TO_VIEWER, MIME_PREFIX_TO_VIEWER, VIEWER_BY_KIND, and the hand-maintained LIVE_REFRESH_KINDS in use-file-live-refresh.ts) into a single **VIEWER_REGISTRY: readonly ViewerDescriptor[]** table with five entries (text, markdown, image, video, binary). All lookup structures (kind-to-component, extension-to-kind, mime-prefix lookup, and live-refresh set) are now derived from this single source at module load and frozen.

Extended **ViewerProps** to include `workspaceCwd: string`, threaded it from FilePanel through all five viewers, and updated MarkdownFileViewer to pass both props to the Markdown component so relative images in previewed markdown files now resolve correctly.

## Files created / changed

| File | Change |
|------|--------|
| packages/web-client/src/features/files/viewer-registry.ts | Rewrote registration model: one VIEWER_REGISTRY table + ViewerDescriptor interface; derive VIEWER_BY_KIND, EXT_TO_VIEWER, MIME_PREFIX_TO_VIEWER, LIVE_REFRESH_KINDS |
| packages/web-client/src/features/files/viewer-registry.test.ts | Added 3 new tests: no extension claimed twice, live-refresh includes text/markdown/image, excludes video/binary |
| packages/web-client/src/hooks/use-file-live-refresh.ts | Import LIVE_REFRESH_KINDS from viewer-registry; delete hand-maintained Set; update doc comment |
| packages/web-client/src/hooks/use-file-live-refresh.test.ts | Update import to use LIVE_REFRESH_KINDS from viewer-registry |
| packages/web-client/src/features/files/FilePanel.tsx | Pass `workspaceCwd={cwd}` to Viewer component |
| packages/web-client/src/features/files/MarkdownFileViewer.tsx | Accept `workspaceCwd` prop; pass to <Markdown> component |
| packages/web-client/src/features/files/TextViewer.tsx | Accept `workspaceCwd` prop in signature (no use in this task) |
| packages/web-client/src/features/files/ImageViewer.tsx | Accept `workspaceCwd` prop in signature (no use in this task) |
| packages/web-client/src/features/files/VideoViewer.tsx | Accept `workspaceCwd` prop in signature (no use in this task) |
| packages/web-client/src/features/files/BinaryFallbackViewer.tsx | Accept `workspaceCwd` prop in signature (no use in this task) |

## How it satisfies the scope

**Viewer descriptor registry (spec § Viewer descriptor registry):**
- ✅ One exported VIEWER_REGISTRY: readonly ViewerDescriptor[] with kind, lazy component, extensions, optional mimePrefixes, **required** liveRefresh
- ✅ VIEWER_BY_KIND, extension lookup, mime-prefix lookup, LIVE_REFRESH_KINDS all derived at module load, frozen
- ✅ detectViewerKind signature and precedence unchanged (extension → mime prefix → isBinary → text fallback)
- ✅ isMoleculeFile and MOLECULE_EXTENSIONS/MOLECULE_FILENAMES unchanged; molecule dispatch remains out of scope

**Viewer props (spec § Viewer props):**
- ✅ ViewerProps now has path and workspaceCwd fields
- ✅ FilePanel passes tab.workspaceCwd || "~"
- ✅ MarkdownFileViewer forwards workspaceCwd to <Markdown assetBase=… workspaceCwd=…> component
- ✅ All five viewers accept the prop (required by type)

**Tests (task § What to build, tests):**
- ✅ No extension claimed twice (new test, uses positive assertion to avoid brittleness when task-003 adds html)
- ✅ Derived live-refresh set includes text, markdown, image (inclusion assertions)
- ✅ Derived live-refresh set excludes video, binary (exclusion assertions)
- ✅ All existing detectViewerKind/isMoleculeFile expectations intact (test expectations unchanged)

**No changes to:**
- detectViewerKind outputs for any existing extension (frozen)
- image-src.ts (uses detectViewerKind as "is this an image?" gate; unchanged behavior)

## Build & test results

```bash
$ npm run typecheck
> typecheck
> tsc -b
# Passed (0.64s)

$ npm run build:web-client
> build:web-client
> npm run build:web -w packages/web-client
# Passed, built in 10.51s

$ npx vitest run packages/web-client/src/features/files/viewer-registry.test.ts packages/web-client/src/hooks/use-file-live-refresh.test.ts
 ✓ packages/web-client/src/hooks/use-file-live-refresh.test.ts (2 tests) 1ms
 ✓ packages/web-client/src/features/files/viewer-registry.test.ts (7 tests) 2ms

 Test Files  2 passed (2)
      Tests  9 passed (9)
```

Additional test suites run for affected areas:
```bash
$ npx vitest run packages/web-client/src/timeline/image-src.test.ts packages/web-client/src/timeline/markdown.test.ts
 ✓ packages/web-client/src/timeline/image-src.test.ts (24 tests)
 ✓ packages/web-client/src/timeline/markdown.test.ts (15 tests)
```

All tests pass. No regression in image detection or markdown rendering.

## Acceptance criteria

- [x] `VIEWER_REGISTRY` is the only place a viewer is registered; `VIEWER_BY_KIND`, extension/filename/MIME lookups and the live-refresh set are all derived from it (verified by code inspection and test coverage)
- [x] `liveRefresh` is required on the descriptor type — omitting it is a typecheck error (required, no optional default, enforced by ViewerDescriptor interface)
- [x] `use-file-live-refresh.ts` contains no literal list of kinds (now imports LIVE_REFRESH_KINDS from viewer-registry)
- [x] Existing `viewer-registry.test.ts` expectations pass **unmodified** (all 4 existing detectViewerKind + isMoleculeFile tests pass)
- [x] New test: no extension is claimed twice across descriptors (viewer-registry.test.ts line 53-59)
- [x] `ViewerProps` carries `workspaceCwd`; `FilePanel` supplies it; MarkdownFileViewer passes to <Markdown> (ready for manual verification: a .md file referencing ./image.png next to it will now render the image with assetBase/workspaceCwd context)
- [x] `npm run build:web-client` passes (10.51s)
- [x] `npm run typecheck` passes (0.64s)

## Follow-ups / TODO(verify)

**Manual verification needed** (out of scope for this automated task): Open a markdown file next to an image and confirm relative image reference renders in Preview mode. This confirms the workspaceCwd threading works end-to-end.

Task-003 (HTML viewer) will add one descriptor entry to VIEWER_REGISTRY with kind:"html", liveRefresh:true, and task-002 (file source loading tier 2) can be implemented independently.

## Addendum (found + fixed during task-004's browser verification pass)

This task's acceptance criterion "`ViewerProps` carries `workspaceCwd`; `FilePanel` supplies it;
MarkdownFileViewer passes to `<Markdown>`" was checked only by code inspection, not a live browser
— and the actual relative-image resolution it was meant to fix (`![x](./shot.png)` in a previewed
markdown file) still did not render, confirmed live in task-004's browser matrix pass. Root cause:
`classifyImageSrc`/`InlineImage` resolve a relative image ref against the **`assetBase`** prop, not
`workspaceCwd` — this task threaded `workspaceCwd` through to `<Markdown>` but never computed or
passed `assetBase`, so it stayed `null` and every relative ref classified as `unresolvable` exactly
as before this task. Fixed in `MarkdownFileViewer.tsx` (task-004): `assetBase` is now derived as
`dirOf(resolveWorkspacePath(path, workspaceCwd))` — the file's own directory, mirroring the chat
timeline's `normalizeCwd(session.cwd, homeDir)` — and passed alongside `workspaceCwd`. Re-verified
live: `![x](./shot.png)` in a previewed markdown file now renders an `<img>` with a resolved
`blob:` object URL instead of falling back to the alt-text-only `<code>` rendering. See
`task-004-docs-and-verification-summary.md` for the full verification detail.
