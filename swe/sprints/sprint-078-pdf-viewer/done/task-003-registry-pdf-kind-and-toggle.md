# Task 003 — Registry: `pdf` kind, descriptor `toggle`, `resolveViewerKind`, FilePanel dispatch

- **Sprint:** sprint-078-pdf-viewer
- **Status:** done
- **Type:** feature
- **Area:** packages/web-client (features/files)
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-002 (the `pdf` descriptor's lazy component)

## Goal

`.pdf` files dispatch to a `pdf` viewer kind that falls back to `binary` while the `pdfviewer`
viewer-settings row is disabled. The fallback is resolved once per FilePanel mount.

## Context / why

The registry is the single registration point (`packages/web-client/AGENTS.md` § "Adding a file
viewer"), but it has no notion of a viewer that can be switched off: the only toggleable viewer
(molviewer) has its own tab kind and gates at open time. A file-kind viewer needs the gate where
`FilePanel` resolves its kind. Putting `toggle` on the descriptor keeps it a registry fact instead of
an `if (kind === "pdf")` in the panel, and resolving once per mount preserves the invariant that
disabling a viewer never changes an already-open tab.

## Scope references

- `swe/features/pdf-file-preview.md` § Public contract › Viewer registry, › FilePanel dispatch
- `packages/web-client/src/features/files/viewer-registry.ts` (+ `viewer-registry.test.ts`)
- `packages/web-client/src/features/files/FilePanel.tsx`
- `packages/web-client/src/viewer-plugins/viewer-settings-store.ts` (`isViewerEnabled` module export)
- `packages/web-client/src/hooks/use-file-live-refresh.ts` (+ test; header comment lists kinds)

## What to build

- `ViewerKind` += `"pdf"`. `ViewerDescriptor` += optional `toggle?: { id: string; fallback: ViewerKind }`.
- The `pdf` descriptor as specified (extensions `["pdf"]`, MIME prefix `application/pdf`,
  `liveRefresh: true`, toggle `pdfviewer` → `binary`). Remove `"pdf"` from the `binary` descriptor.
- `resolveViewerKind(path, isEnabled: (id: string) => boolean, opts?) → ViewerKind`, pure, derived
  from a frozen kind→descriptor lookup built from `VIEWER_REGISTRY` like the other derived tables.
- `FilePanel`: resolve the kind once per mount through `resolveViewerKind(path, isViewerEnabled)`
  (lazy `useState` initializer), and use it for both `useFileLiveRefresh` and `VIEWER_BY_KIND`.
- Update stale comments that enumerate kinds (`FilePanel.tsx` header, `use-file-live-refresh.ts`
  header, registry header).

## Out of scope

- The PdfViewer component itself (task-002). Settings row (task-004).

## Acceptance criteria

- [x] `detectViewerKind("doc.pdf")` and `detectViewerKind("DOC.PDF")` are `"pdf"`;
      `detectViewerKind("blob", { mimeHint: "application/pdf" })` is `"pdf"`.
- [x] `resolveViewerKind("doc.pdf", () => false)` is `"binary"`;
      `resolveViewerKind("doc.pdf", () => true)` is `"pdf"`; a descriptor with no `toggle` ignores
      `isEnabled` (`resolveViewerKind("a.png", () => false)` is `"image"`).
- [x] `.zip`, `.wasm`, `.woff2` etc. still resolve to `"binary"`; `LIVE_REFRESH_KINDS` contains `"pdf"`.
- [x] `classifyImageSrc` still rejects `.pdf` (existing `image-src.test.ts` case stays green).
- [x] An open PDF tab does not change viewer when the toggle flips. The next mount does.

## Test / verification plan

- Tests: extend `viewer-registry.test.ts` with the criteria above (behaviour, not table shape);
  extend `use-file-live-refresh.test.ts` for `pdf`.
- Run: `npx vitest run packages/web-client/src/features/files packages/web-client/src/hooks packages/web-client/src/timeline/image-src.test.ts`.
- Typecheck: `npm run typecheck`.

## Notes

- `isEnabled` is injected, not imported, so the registry module stays free of the zustand store
  and the pure function stays trivially testable (the `tabFromIdentity` precedent).
