# Task 004 — Frontend: the `preview` member of the desktop host

- **Sprint:** sprint-105-desktop-html-preview-origin
- **Status:** backlog
- **Type:** feature
- **Area:** desktop/apps/pistudiodesktop/src/host
- **Priority:** P1
- **Estimated size:** XS
- **Depends on:** task-002, task-003

## Goal
In the app window the HTML viewer loads its document from the preview origin on platforms that can, and shows the "scripts are disabled" line on the others.

## Scope references
- `swe/features/desktop-native-host.md` § Public contract 2 (row `preview`), § HTML preview origin
- `desktop/apps/pistudiodesktop/src/host/` (`desktop-host.ts`, `ipc.ts`, snapshot validation: sprint-103/task-003)
- `packages/workbench/src/host/types.ts` (`HostPreview`: task-002)

## What to build
- Snapshot validation accepts `preview: "origin" | "inert"`.
- `origin`: `{ kind: "origin", mount }` where `mount(html)` calls `preview_mount` and returns `{ url, release }`; `release` calls `preview_release` once, without waiting, and is safe to call twice.
- `inert`: `{ kind: "inert" }`.
- Outside Tauri the browser host is used and has no `preview`: unchanged.
- Unit tests over a fake `ipc`.

## Out of scope
- Everything in Rust (task-003) and in the viewer (task-002).

## Acceptance criteria
- [ ] With `preview: "origin"`, `mount` returns the URL Rust answered and `release` sends one `preview_release` however often it is called.
- [ ] A `preview_mount` failure rejects `mount` with the reason.
- [ ] With `preview: "inert"`, the member is `{ kind: "inert" }` and no command is sent.
- [ ] A snapshot without the field, or with another value, fails validation.
- [ ] `npm run check`, `npm run lint`, `npm test` and `cargo xtask web` pass.

## Test / verification plan
- In `desktop/apps/pistudiodesktop`: `npm run check && npm run lint && npm test`
- `cargo xtask web` in `desktop/`

## Notes
- Edits `desktop-host.ts` after sprint-104/task-007 (reached through task-003's dependency).
