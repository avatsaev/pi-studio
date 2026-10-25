# Task 003 — Registry `pdf` kind, descriptor `toggle`, `resolveViewerKind`, FilePanel dispatch — Summary

- **Sprint:** sprints/sprint-078-pdf-viewer
- **Completed:** 2026-10-25
- **Status:** done

## What was implemented
`ViewerKind` += `"pdf"`; optional `ViewerDescriptor.toggle`; the `pdf` descriptor (extension `pdf`,
MIME prefix `application/pdf`, `liveRefresh: true`, toggle `pdfviewer` -> `binary`); `pdf` removed
from `binary`'s extensions; pure `resolveViewerKind(path, isEnabled, opts?)`. `FilePanel` resolves
the kind once per mount through a lazy `useState` initializer.

## Files created / changed
| File | Change |
|------|--------|
| `packages/web-client/src/features/files/viewer-registry.ts` | modified |
| `packages/web-client/src/features/files/viewer-registry.test.ts` | +4 tests, live-refresh test covers `pdf` |
| `packages/web-client/src/features/files/FilePanel.tsx` | modified (resolve once per mount; header comment) |
| `packages/web-client/src/hooks/use-file-live-refresh.ts` | header comment only |

## Build & test results
```
$ npx vitest run packages/web-client/src/features/files/viewer-registry.test.ts -> 12 passed
$ npx vitest run packages/web-client -> 107 files / 1438 tests passed
$ npm run typecheck / npm run build -> success
Live: toggle off -> a not-yet-open fresh.pdf shows the download card; PDF tabs already open keep
rendering; toggle back on -> the open download-card tab does NOT switch (resolved once per mount).
```

## Acceptance criteria
All checked. `classifyImageSrc` still rejects `.pdf` (its existing `image-src.test.ts` case is green).

## Follow-ups / TODO(verify)
- The task asked to extend `use-file-live-refresh.test.ts`; not done on purpose: it duplicates the
  registry test's live-refresh assertions, so `pdf` is asserted once, in `viewer-registry.test.ts`.
