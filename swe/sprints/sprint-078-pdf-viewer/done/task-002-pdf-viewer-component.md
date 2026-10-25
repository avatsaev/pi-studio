# Task 002 — `PdfViewer` component

- **Sprint:** sprint-078-pdf-viewer
- **Status:** done
- **Type:** feature
- **Area:** packages/web-client (features/files)
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** task-001

## Goal

A lazy-loaded viewer that renders a PDF as a scrollable page stack with selectable text, fit-width
and stepped zoom, a page indicator, a Download action, bounded memory, and live refresh that keeps
the scroll position.

## Context / why

This is the user-visible half of the sprint. Rendering decisions and their reasons are in the spec's
Decisions table: pdf.js core API rather than the `pdf_viewer` bundle, and no annotation, form or
scripting layers.

## Scope references

- `swe/features/pdf-file-preview.md` § PdfViewer component, § Behavior & algorithms,
  § Error handling & edge cases
- Create: `packages/web-client/src/features/files/PdfViewer.tsx`, `PdfViewer.module.css`
- Pure helpers (create, + test): `packages/web-client/src/features/files/pdf-layout.ts`
- Its registry entry lands in task-003. Until then, verify it by mounting it in a throwaway
  harness; do not ship a placeholder.
- Consumes: `pdfjs-runtime.ts` (task-001), `hooks/use-file-download.ts`, `ViewerProps` (registry)
- Patterns: `VideoViewer.tsx` / `ImageViewer.tsx` (download states), `BinaryFallbackViewer.tsx`
  (download link), `components/primitives/Button.tsx`, `EmptyState`, `Spinner`

## What to build

- `pdf-layout.ts` (pure, framework-free): zoom ladder `next/prevZoom(scale)`, `fitWidthScale(
  containerWidth, padding, widestPageWidth)`, `canvasPixelRatio(scale, pageSize, dpr, maxArea)`, and
  `pageAtMidpoint(pageOffsets, scrollTop, viewportHeight)`.
- `PdfViewer({ path, workspaceCwd })`:
  - bytes via `useFileDownload(path)`; document via `loadPdfjs().getDocument({ url, isEvalSupported:
    false, enableXfa: false, cMapUrl, cMapPacked: true, standardFontDataUrl, wasmUrl, iccUrl })`;
  - page sizes fetched once per document; new document replaces the old in one commit (scroll
    container never remounts); previous document destroyed;
  - each page block sized before render; canvas + `TextLayer` rendered only while near-visible
    (IntersectionObserver), released when far; in-flight render tasks cancelled on scale or document
    change and on unmount;
  - toolbar: `current / total`, zoom out / in, Fit width toggle (default on, recomputed on
    container resize), zoom %, Download (`<a download>` on the existing object URL);
  - error states per the spec table (download error, invalid PDF, password-protected, zero pages,
    per-page render error), offering Download wherever bytes exist.
- CSS module: tokens only (the `theme/` token-integrity and font-scale tests enforce this); the
  text-layer rules pdf.js requires, scoped with `:global(.textLayer)` under the module's page class;
  page blocks with a visible paper edge on the pane background.

## Out of scope

- Find/search, outline, thumbnails, rotation, print, links/annotations, password entry.

## Acceptance criteria

- [x] A real multi-page PDF renders every page while scrolling. The page indicator follows the
      viewport midpoint.
- [x] Text on a rendered page is selectable and copies as text.
- [x] Fit width follows pane resizes. Zoom steps re-render crisp pages and turn Fit width off.
- [x] On a long document only near-visible pages hold a `<canvas>`.
- [x] Rewriting the file on disk re-renders it and keeps `scrollTop`.
- [x] Invalid file, encrypted file and download failure each show their message. The first two
      still offer Download.
- [x] Unmounting the tab destroys the document (no worker-side leak of the loading task).

## Test / verification plan

- Tests: `pdf-layout.test.ts` covers the pure helpers' boundaries: zoom ladder ends, fit width with
  zero/negative width, pixel-area cap, midpoint at first/last page.
- Run: `npx vitest run packages/web-client/src/features/files`.
- Build/typecheck/lint: `npm run build:web-client`, `npm run typecheck`, `npx oxlint packages/web-client`.
- Manual (browser): every acceptance criterion above against the dev daemon + Vite, using a
  generated multi-page PDF, a corrupt `.pdf`, and an encrypted PDF.

## Notes

- `useFileDownload` owns the object URL's lifetime. The viewer must not revoke it.
- Keep the canvas cap and the near-visible margin as named constants with a one-line rationale.
