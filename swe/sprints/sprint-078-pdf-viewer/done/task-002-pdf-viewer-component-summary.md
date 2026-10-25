# Task 002 — `PdfViewer` component — Summary

- **Sprint:** sprints/sprint-078-pdf-viewer
- **Completed:** 2026-10-25
- **Status:** done

## What was implemented
`PdfViewer` (+ CSS module) and the pure `pdf-layout.ts`. Page stack of pre-sized blocks; each block
renders canvas + pdf.js `TextLayer` off-screen and swaps them in whole, only while within one
viewport of the scroller (IntersectionObserver), releasing them when far. Toolbar: page indicator,
zoom out/in on a fixed ladder, Fit width toggle (default on, follows pane resizes, debounced),
zoom %, Download. Error states: download error, invalid PDF, password-protected, zero pages,
per-page render error. Live refresh loads the new document beside the old and commits both in one
state update, so the scroll container never remounts.

## Files created / changed
| File | Change |
|------|--------|
| `packages/web-client/src/features/files/PdfViewer.tsx` | created |
| `packages/web-client/src/features/files/PdfViewer.module.css` | created (tokens only; text-layer rules mirror pdf.js's `.textLayer`) |
| `packages/web-client/src/features/files/pdf-layout.ts` | created |
| `packages/web-client/src/features/files/pdf-layout.test.ts` | created (12 tests) |

## How it satisfies the scope
Matches spec § PdfViewer component. Deviations, both written back into the spec:
- The document is loaded from **bytes** (`fetch(objectUrl)` → `data`), not `url`: `useFileDownload`
  revokes an object URL as soon as a refresh supersedes it, which would break the still-displayed
  old document mid-load.
- pdf.js v6 has no `isEvalSupported` option (it never evals), so only `enableXfa: false` is set.
- Ownership: pdf.js v6 `PDFDocumentProxy` has no `destroy()`; the loading task owns the document and
  is what gets destroyed.

## Build & test results
```
$ npx vitest run packages/web-client   -> 107 files, 1438 tests passed (before the registry tests were added)
$ npm run build:web-client             -> success; PdfViewer chunk 6.7 kB, vendor-pdfjs 484 kB
Live (Chromium, real daemon on /tmp/pdf-e2e fixtures, DOM probes scoped to the visible tab):
  multi.pdf  6 pages incl. a landscape A4 page: indicator 1/6 -> 3/6 -> 6/6 while scrolling;
             canvases 2-4 of 6 pages at any time; 62 text spans per rendered page; a Range over a
             page's text layer returns the page's text ("Page 6 of 6\nLine 0: …")
  long.pdf   120 pages, scrollHeight 99245: canvases stay at 2-4 across scrollTop 0/30000/60000/end;
             indicator 1/120 -> 37/120 -> 74/120 -> 120/120
  zoom       Zoom in from fit (103%) -> 125%, page 612pt -> 765px, Fit width aria-pressed=false
  fit width  panel hidden/shown: page 868px <-> 1148px (142% <-> 188%); backing store 1085px for an
             868px page at devicePixelRatio 1.25
  refresh    rewrote multi.pdf (6 -> 9 pages) while scrolled to 2000: same scroller element
             (tagged), scrollTop still 2000, indicator 3/9, text now "REWRITTEN n of 9"
  errors     corrupt.pdf and a 0-byte .pdf -> "This file could not be opened as a PDF." + Download;
             secret.pdf (encrypted) -> "This PDF is password-protected." + Download
```

## Acceptance criteria
- [x] Multi-page render and page indicator (live)
- [x] Text selectable (live: Range over the text layer yields the page text)
- [x] Fit width follows resizes; zoom steps re-render and turn Fit width off (live)
- [x] Only near-visible pages hold a canvas (live, 120-page document)
- [x] Rewriting the file re-renders and keeps `scrollTop` (live)
- [x] Invalid / encrypted / download-failure messages. The first two verified live with Download offered; the download-failure branch reuses the other viewers' `EmptyState` and was not forced.
- [x] Unmount destroys the document: implemented in the effect cleanup; **not directly observed** (no worker-side leak probe).

## Follow-ups / TODO(verify)
- No automated test for the component itself: web-client's vitest runs in a plain Node environment
  with no DOM, so the component is covered by the live pass above and its pure maths by tests.
- Native clipboard copy (Ctrl+C) was not exercised; selection was verified through the DOM Range.
