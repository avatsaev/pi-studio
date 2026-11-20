# Task 008 — Live checks: dialogs, links, save (Linux webview and web client), and documents

- **Sprint:** sprint-104-desktop-dialogs-links-save
- **Status:** backlog
- **Type:** test
- **Area:** desktop (app in the WebDriver container), packages/web-client (browser), documents
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** task-002, task-007

## Goal
Native dialogs, external links and save to disk are observed working in the real Linux webview, the two workbench changes are observed in the web client, and the documents are current.

## Context / why
None of these can be proven by unit tests: a native dialog is drawn by GTK outside the page, a link leaves the app, and a save crosses the page, Rust and the file system.

## Scope references
- `swe/features/desktop-native-host.md` § Acceptance criteria (dialog, rename, link, download, cancel, transfer rows), § TODO(verify) (native dialogs from an asynchronous call, save throughput, the file input)
- `desktop/docs/development.md` (WebDriver container), `desktop/docs/architecture.md` § The webview boundary
- `packages/workbench/README.md` § The host, `packages/workbench/AGENTS.md`, `docs/desktop-client-handoff.md`

## What to build
No product code unless a check fails. A native dialog is not part of the page, so WebDriver cannot see it: take a screenshot of the X display and answer it with keyboard input sent to the display (add the needed tool to the check image).

**Desktop app, Linux, dev daemon:**
1. Delete a file: a native confirm appears; "no" leaves the file, "yes" deletes it. While it is open, a `settings.get` over the control socket still answers.
2. Trigger an alert (for example an upload failure): native, closes, the app continues.
3. Click an `https` link in a mock message: the system opener is called with that URL (put a recording script named like the opener first on `PATH`) and the window stays on the workbench. A `file:` and a `javascript:` link call nothing.
4. Download a 1 GiB file: the native save dialog chooses the destination; the saved file's SHA-256 equals the source's. Record the duration and the peak memory of the app's processes during the save.
5. Cancel the save dialog: no file, no message.
6. Stop the daemon midway through a save: no file and no temporary file at the destination; the explorer shows the failure.
7. Close the window during a save: the confirm appears; "no" keeps the app and the save completes.
8. Rename a session: the in-app dialog, as in the web client.
9. The upload button: record what opens (spec TODO: the file input in a webview).

**Web client, browser:**
10. Rename dialog: Enter, Escape, focus return.
11. A web link opens a new tab; a `#fragment` link does not.

**Documents:** the webview boundary section (the page's command list, what each validates), the workbench README and AGENTS host rows (`saveTarget`, dialogs without `prompt`, external links), the handoff document.

## Out of scope
- macOS and Windows (sprint-106).

## Acceptance criteria
- [ ] Checks 1–8, 10 and 11 pass, each with its evidence in the summary.
- [ ] Check 4's memory stays flat (the peak is within a small multiple of the 8 MiB range, not of the file) and the figures are recorded. If the save is too slow to use, the summary says so with the number; do not redesign here.
- [ ] Check 9 has a recorded observation.
- [ ] The documents listed match the code.
- [ ] `cargo xtask ci` and the root `npm run build`, `npm run typecheck`, `npm run lint`, `npm test` pass.

## Test / verification plan
- WebDriver session plus X-display screenshots in the `pi-desktop-xvfb` container.
- `sha256sum` of source and destination; process memory sampled during the save.
- The gates named above.

## Notes
- Run in the orchestrator: ports, the shared container, a browser.
- Root gates apply because `packages/workbench` changed in this sprint.
