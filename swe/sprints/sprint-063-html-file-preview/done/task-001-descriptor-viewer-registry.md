# Task 001 — Descriptor-driven viewer registry + `ViewerProps.workspaceCwd`

- **Sprint:** sprint-063-html-file-preview
- **Status:** done
- **Type:** refactor
- **Area:** web-client / features/files
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** none

## Goal
Collapse the viewer registry's four parallel registration sites into one descriptor table with
derived lookups, and give viewers the `workspaceCwd` they need to resolve sibling files — fixing the
previewed-markdown relative-image defect as a side effect, with no change to any existing viewer's
dispatch outcome.

## Context / why
`packages/web-client/src/features/files/viewer-registry.ts` claims adding a file type is "one entry
in `EXT_TO_VIEWER`/`MIME_PREFIX_TO_VIEWER` plus one entry in `VIEWER_BY_KIND`". It is four edits, and
the fourth lives in another directory: `LIVE_REFRESH_KINDS` (`hooks/use-file-live-refresh.ts:23`),
whose own doc comment says "a new `ViewerKind` must make an explicit choice here" while nothing
enforces it — a forgotten kind silently gets no live refresh.

Second gap, same root: `ViewerProps` is `{ path }` only (`viewer-registry.ts:17-20`). `FilePanel`
holds the tab's workspace (`FilePanel.tsx:56`) and keeps it. So `MarkdownFileViewer` renders
`<Markdown text={…} />` with no `assetBase`/`workspaceCwd` (`MarkdownFileViewer.tsx:61`) even though
`Markdown` supports both (`timeline/markdown.tsx:190-224`) — **relative images in a previewed
markdown file never resolve today**. Task 003's HTML viewer needs the same context for the same
reason, so the contract is fixed here, once.

Hard constraint: `detectViewerKind` is not only FilePanel's dispatch — `timeline/image-src.ts:67`
uses it as the "is this an image?" gate for markdown image classification. Its outputs are frozen.

## Scope references
- `swe/features/html-file-preview.md` § Viewer descriptor registry, § Viewer props
- `packages/web-client/src/features/files/viewer-registry.ts` (rewrite the registration shape)
- `packages/web-client/src/features/files/viewer-registry.test.ts` (extend; existing expectations
  must keep passing unchanged)
- `packages/web-client/src/hooks/use-file-live-refresh.ts` (consume the derived set)
- `packages/web-client/src/features/files/FilePanel.tsx` (thread `workspaceCwd`)
- `packages/web-client/src/features/files/MarkdownFileViewer.tsx`,
  `TextViewer.tsx`, `ImageViewer.tsx`, `VideoViewer.tsx`, `BinaryFallbackViewer.tsx` (props signature)
- `packages/web-client/src/timeline/image-src.ts` (consumer that must not change behavior)

## What to build
- `viewer-registry.ts`: one exported `VIEWER_REGISTRY: readonly ViewerDescriptor[]` per the spec's
  shape (`kind`, lazy `component`, `extensions`, optional `mimePrefixes`, **required**
  `liveRefresh`). Derive at module load, frozen: kind→component (`VIEWER_BY_KIND`, same exported
  name/shape), extension→kind, ordered mime-prefix pairs, and `LIVE_REFRESH_KINDS`.
  `detectViewerKind(path, { mimeHint?, isBinary? })` keeps its exact signature and its existing
  precedence (extension → mime prefix → `isBinary ? "binary" : "text"`) — no new matching steps; in
  particular no basename/filename matching, which today exists only for molecule detection and stays
  in `isMoleculeFile`. `isMoleculeFile` keeps its signature; `MOLECULE_EXTENSIONS`/
  `MOLECULE_FILENAMES` stay exported (molecule dispatch is out of scope — see below).
- `ViewerProps` gains `workspaceCwd: string`; `FilePanel` passes its existing `cwd` value; every
  viewer's props type updates (only `MarkdownFileViewer` consumes it in this task).
- `MarkdownFileViewer`: pass `assetBase`/`workspaceCwd` through to `<Markdown>` so relative images
  resolve, matching how the chat render path threads them.
- `use-file-live-refresh.ts`: import the derived live-refresh set; delete the hand-maintained
  `new Set([...])` and rewrite the doc comment to say the choice now lives in the descriptor
  (`liveRefresh`), enforced by the type.
- Tests in `viewer-registry.test.ts`: no extension claimed by two descriptors; no descriptor claims
  an extension also in `MOLECULE_EXTENSIONS` unless deliberate; the derived live-refresh set
  includes `text`, `markdown`, `image` and excludes `video`, `binary` — written as inclusion +
  exclusion assertions, **not** exact set equality, so task-003's `html` addition extends it without
  editing this test; every existing `detectViewerKind`/`isMoleculeFile` expectation intact.

## Out of scope
- The `html` descriptor and `HtmlViewer` (task-003).
- Folding molecule's separate tab-kind dispatch (`open-file-tab.ts` → `PANEL_BY_KIND.molecule`) into
  the registry. Recorded as a known second dispatch path; it touches persisted tab identities
  (`reopen-client-tabs.ts`) and is not this sprint's risk to take.
- Any change to `detectViewerKind`'s outputs, or to `image-src.ts`.

## Acceptance criteria
- [x] `VIEWER_REGISTRY` is the only place a viewer is registered; `VIEWER_BY_KIND`, extension/
      filename/MIME lookups and the live-refresh set are all derived from it.
- [x] `liveRefresh` is required on the descriptor type — omitting it is a typecheck error.
- [x] `use-file-live-refresh.ts` contains no literal list of kinds.
- [x] Existing `viewer-registry.test.ts` expectations pass **unmodified**.
- [x] New test: no extension is claimed twice across descriptors.
- [x] `ViewerProps` carries `workspaceCwd`; `FilePanel` supplies it; a previewed markdown file with
      `![x](./shot.png)` next to it renders the image (manual check in a real browser) — required an
      additional `assetBase` fix during task-004's browser pass; see this file's Addendum.
- [x] `npm run build:web-client` and `npm run typecheck` pass.

## Test / verification plan
- Unit: `npx vitest run packages/web-client/src/features/files packages/web-client/src/hooks packages/web-client/src/timeline`
  (registry, live-refresh gate, and the image-src/markdown suites that depend on `detectViewerKind`).
- Build: `npm run build:web-client`; typecheck: `npm run typecheck`.
- Manual: open a markdown file that sits beside an image and references it relatively; the image
  renders in Preview mode. Open a `.ts`, a `.png`, an `.mp4` and a `.zip` — each still lands in the
  same viewer as before.

## Notes
`tsc` incremental builds in this repo have been observed to miss errors after a signature change
(stale `.tsbuildinfo`): run `npm run clean` or force the build once when changing `ViewerProps`.
