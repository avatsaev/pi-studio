# Task 001 — Spike: a sandboxed frame served from a custom scheme

- **Sprint:** sprint-105-desktop-html-preview-origin
- **Status:** done
- **Type:** test
- **Area:** desktop/apps/pistudiodesktop (throwaway experiment), swe/notes
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** none

## Goal
A written, measured answer to: does a sandboxed frame loaded from the app's own custom scheme run its scripts in the Linux webview while staying isolated from the app, and exactly which URL form, headers and policy entry does it need?

## Context / why
D7. The HTML preview is a `srcdoc` frame, which inherits the window's Content-Security-Policy, so the previewed page's scripts are blocked in the desktop app. Serving the document from another origin should give it its own policy. Nobody has tried it in any of the three webviews, and the design of task-003 depends on the answer.

## Scope references
- `swe/features/desktop-native-host.md` § HTML preview origin, § TODO(verify) (first entry); grill D7
- `swe/features/html-file-preview.md`, `packages/workbench/src/features/files/html-sandbox.ts` (the two invariants: never `allow-same-origin`; the policy tag is a network policy, not the isolation boundary)
- `desktop/apps/pistudiodesktop/src-tauri/tauri.conf.json` (`app.security.csp`), `src/main.rs`
- `desktop/docs/development.md` (the real webview under WebDriver)

## What to build
A throwaway experiment (not merged): register a custom scheme in the app, serve one HTML document from it with the response headers of the spec (`Content-Security-Policy: sandbox allow-scripts`, `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`), and load it in an `<iframe sandbox="allow-scripts">` inside the app's page.

Measure in the Linux webview (WebKitGTK, WebDriver container) and write down:

1. Does an inline script in the framed document run?
2. Which URL form the webview needs for the scheme, and the exact `frame-src` source that lets the window load it.
3. From inside the frame, each of these must fail; record how: reading `parent.document`, calling the app's command channel, opening a popup, reading `localStorage`.
4. Is the `sandbox` response header honoured when the same URL is opened outside a frame?
5. Does the "Block remote resources" policy tag inside the document still block a remote image and a `fetch`?

If the custom scheme cannot run scripts on Linux, try the alternatives in this order and record each: a `blob:` URL frame, then a document served by a loopback HTTP listener in Rust. If none works, stop and report: task-003 and task-004 are then blocked, not improvised.

Write `swe/notes/desktop-preview-origin-spike.md`: the answers, the minimal code shape that worked (signatures and header values, no pasted implementation), and a short procedure plus the probe page so a person can repeat the measurement on macOS and Windows in a few minutes.

## Out of scope
- Product code. Anything on macOS or Windows (the procedure is run in sprint-106/task-002).

## Acceptance criteria
- [ ] The notes file answers questions 1–5 for Linux with what was observed, not what is expected.
- [ ] It gives the per-platform result table: Linux measured; macOS and Windows "not measured".
- [ ] It contains the repeatable procedure and the probe page.
- [ ] No experiment code is left in the working tree; `cargo xtask ci` passes.

## Test / verification plan
- The WebDriver container for every observation; screenshots or script results quoted in the notes.
- `git status` clean apart from the notes file; `cargo xtask ci`.

## Notes
- Independent of every other task: it can run at any time, including first.
- Until macOS and Windows are measured they are treated as unable (`"inert"`), the safe side of D7.
