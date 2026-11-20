# Task 004 — Live checks in the real webview (Linux) and documents

- **Sprint:** sprint-103-desktop-host-boot-storage
- **Status:** done
- **Type:** test
- **Area:** desktop (app in the WebDriver container), desktop/docs
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-002, task-003

## Goal
Storage in Rust, the boot path, single instance and the navigation rule are observed working in the real Linux webview, and the documents describe the new webview boundary.

## Context / why
Unit tests cover the decisions. Whether the webview really boots through Rust, persists across a restart, and refuses to leave the app can only be seen in the app. This machine has no display: the app runs under WebKit's WebDriver in the `pi-desktop-xvfb` container.

## Scope references
- `swe/features/desktop-native-host.md` § Acceptance criteria (storage, corrupt file, second launch, capability rows), § TODO(verify) (`pagehide`, configuration directory, drops with the handling off)
- `desktop/docs/development.md` (driving the real webview under WebDriver; the dev daemon on another port)
- `desktop/docs/architecture.md` § The webview boundary, `desktop/AGENTS.md` golden rule 6, `docs/desktop-client-handoff.md`

## What to build
No product code unless a check fails. Run, against a dev daemon (`PI_STUDIO_LISTEN=127.0.0.1:6790 npm run dev:daemon`) and with `--config-dir <tmp>`:

1. Open a workspace, split a pane, quit, start again: the layout is back, read from `<tmp>/daemon-state/local.json`.
2. The webview's own `localStorage` holds none of `pi-studio-pane-layout`, `pi-studio-agent-todos-ui`, `pi-studio-appearance`.
3. Change the theme: it is in `<tmp>/settings.json` under `workbench`.
4. Replace `settings.json` with garbage and start: the app opens with defaults, a `settings.json.corrupt-*` file exists, the notice is shown once and not again after a page reload.
5. Start the app a second time: one process, the first window focused.
6. From the page, `location.href = "https://example.com"`: the window is still on the workbench.
7. From the page, invoke a command that is not listed: rejected.
8. Dispatch an HTML5 file drop on the file explorer: the file uploads.
9. Change the layout and close the window within 250 ms; restart. Record whether the change survived (spec TODO: `pagehide` on close), and the same after a page reload.

Then update the documents: the webview boundary section (the page's two commands, no event, the capability file), the configuration directory and its files and the `--config-dir` override in `development.md`, golden rule 6's wording, the handoff document's status row.

## Out of scope
- macOS and Windows (sprint-106).
- A real drag from the desktop: it cannot be driven here and is in the platform checklist.

## Acceptance criteria
- [ ] Checks 1–8 pass, each with its evidence (file content, process list, WebDriver result, screenshot) in the task summary.
- [ ] Check 9 has a recorded result. If changes made in the last 250 ms are lost, the summary says so and the spec's TODO(verify) entry is updated with the finding; a fix is proposed, not improvised.
- [ ] The documents listed above match the code.
- [ ] `cargo xtask ci` passes.

## Test / verification plan
- The WebDriver session from `desktop/docs/development.md`; screenshots through the WebDriver protocol.
- `cargo xtask ci` in `desktop/`.

## Notes
- Live checks need a port and the shared container: run them in the orchestrator, not in a parallel subagent.
- The configuration directory's real location on Linux goes into `development.md` (spec TODO).
