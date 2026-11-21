# Task 005 — Live checks: preview scripts and isolation (Linux webview), and documents

- **Sprint:** sprint-105-desktop-html-preview-origin
- **Status:** done
- **Type:** test
- **Area:** desktop (app in the WebDriver container), documents
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-004, sprint-104/task-008

## Goal
In the real Linux webview, a previewed HTML page runs its scripts and cannot reach the app; the known-gap notes in the documents are replaced by the design.

## Scope references
- `swe/features/desktop-native-host.md` § Acceptance criteria (the two preview rows), § Error handling (preview rows), § TODO(verify) (first entry)
- `swe/notes/desktop-preview-origin-spike.md`
- `desktop/docs/architecture.md` § The webview boundary ("Known gap" paragraph, policy table), `desktop/docs/development.md`, `docs/desktop-client-handoff.md` ("Known gap" mentions), `swe/features/html-file-preview.md`

## What to build
No product code unless a check fails. In the desktop app against a dev daemon, with a workspace holding an HTML file whose inline script changes the page's text:

1. Preview it: the text shows the script ran.
2. A second file whose script tries to read `parent.document`, call the app's command channel, open a popup and read `localStorage`: each attempt fails, and the app is unaffected.
3. "Block remote resources" on: a remote image and a `fetch` in the document are blocked; off: they load.
4. Switch Preview → Source → Preview: the frame is not reloaded (a counter in the page keeps its value).
5. Edit the file on the daemon: the preview refreshes and the old URL answers 404.
6. Open 33 HTML previews: the 33rd shows the viewer's error state and the others work.
7. Reload the page: a URL from before the reload answers 404.
8. `npm run snapshot` (Chromium, browser host): the preview still draws and no new policy violation is reported.

Then the documents: replace the "Known gap" paragraph with how the preview is served and the per-platform table (`origin` or `inert`, and which were measured); add the `frame-src` row to the policy table; update the handoff document and cross-reference from `html-file-preview.md`.

## Out of scope
- macOS and Windows: the spike's procedure is run in sprint-106/task-002.

## Acceptance criteria
- [ ] Checks 1–8 pass on Linux with evidence in the summary. If Linux is `inert` by the spike's result, checks 1–7 are replaced by: the notice is shown and the page's markup is drawn, and the summary says why.
- [ ] The documents listed match the code, and no document still calls the blocked scripts a known gap on a platform where they now run.
- [ ] The spec's first TODO(verify) entry is updated with the Linux result.
- [ ] `cargo xtask ci` and the root `npm run build`, `npm run typecheck`, `npm run lint`, `npm test` pass.

## Test / verification plan
- WebDriver session in the `pi-desktop-xvfb` container; results of in-frame scripts read back through the page.
- The gates named above.

## Notes
- Run in the orchestrator.
- Depends on sprint-104/task-008 because both edit the same documents.
