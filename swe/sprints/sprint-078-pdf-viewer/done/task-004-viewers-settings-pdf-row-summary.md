# Task 004 — Settings → Viewers: "PDF Viewer" row — Summary

- **Sprint:** sprints/sprint-078-pdf-viewer
- **Completed:** 2026-10-25
- **Status:** done

## What was implemented
`ViewersPanel` is now a constant `VIEWER_ROWS` table (Molecule Viewer, PDF Viewer) rendered by one
`ViewerRow` component; a single "Requires a newer daemon." note shows when the daemon lacks
`viewerSettings`. Header comment updated.

## Files created / changed
| File | Change |
|------|--------|
| `packages/web-client/src/features/settings/ViewersPanel.tsx` | modified |

## Build & test results
```
$ npm run typecheck / npx vitest run packages/web-client -> pass
Live (Chromium, two windows against one daemon):
  connected: Molecule Viewer=on, PDF Viewer=on (no pdfviewer row exists -> enabled by default)
  flip PDF Viewer off -> /tmp/pdf-home/viewer-settings.json = {"pdfviewer":{"enabled":false}}
  second window (no reload) flipped to off at the same moment; a fresh window connecting later read
  the stored value; the next opened PDF showed the download card, open PDF tabs did not change
  disconnected / capability-less state (observed after a page reload): both rows on + disabled,
  exactly one "Requires a newer daemon." note
```

## Acceptance criteria
- [x] Both rows render; PDF on with no row.
- [x] Flip persists on the daemon; next open follows it; open tab unchanged. (The request count was not
      intercepted; the daemon-side file change and the second window's update show the RPC happened.)
- [x] Survives a new session and reaches a second window without reload.
- [x] Without `viewerSettings`: rows on, disabled, one note.

## Follow-ups / TODO(verify)
- No component test (Node-only vitest, no DOM); covered by the live pass.
