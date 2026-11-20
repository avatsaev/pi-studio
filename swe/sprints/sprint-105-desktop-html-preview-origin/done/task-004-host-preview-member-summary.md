# Task 004 — Host preview member — Summary

Sprint 105, completed 2026-11-20, status: done.

## What was implemented
- `boot.ts`: `BootSnapshot` now carries `preview: "origin" | "inert"`. `parseBootSnapshot` returns `null` if the field is missing or has any other value.
- `preview.ts` (new): `createDesktopPreview(kind, ipc, log)` builds the host's `preview` member.
  - `inert` returns `{ kind: "inert" }` and sends no command.
  - `origin` returns `{ kind: "origin", mount }`. `mount(html)` calls `preview_mount` and returns `{ url, release }`. If the answer has no string `url`, `mount` rejects.
  - `release` sends one `preview_release` without waiting. A second call does nothing. A failed send is logged.
  - If `preview_mount` rejects, `mount` rejects with the same reason.
- `desktop-host.ts`: the desktop host now sets `preview` from `snapshot.preview`. Outside Tauri the browser host is used and has no `preview`, so that path is unchanged.

## Files
All under `desktop/apps/pistudiodesktop/src/host/`: `boot.ts`, `boot.test.ts`, `desktop-host.ts`, `preview.ts` (new), `preview.test.ts` (new).

## Build & test results
- `npm run check`, `npm run lint` (deny-warnings), `npm test` (32 tests in 6 files) and `npm run build` pass.
- `cargo xtask web` finished with no errors in the output tail I read.
- I did not run `npm run snapshot` or `cargo xtask ci`.
- `npx oxfmt` reported "Expected at least one target file" for the changed files, so it formatted nothing. Lint passed, but formatting is unchecked.

## Acceptance criteria
- [x] With `preview: "origin"`, `mount` returns the URL Rust answered, and `release` sends one `preview_release` however often it is called (`preview.test.ts`, fake `ipc`).
- [x] A `preview_mount` failure rejects `mount` with the reason (test).
- [x] With `preview: "inert"`, the member is `{ kind: "inert" }` and no command is sent (test).
- [x] A snapshot without the field, or with another value, fails validation (`boot.test.ts` cases for missing and unknown).
- [x] `npm run check`, `npm run lint` and `npm test` pass; `cargo xtask web` passed per its output tail.

## Follow-ups / TODO(verify)
- Run `cargo xtask ci`.
- Run `npm run snapshot -- --out /tmp/ui105.png`.
- Run oxfmt on the five changed files with a working invocation.

## Proposed doc edits
In `desktop/AGENTS.md`, add `host/preview.ts` to the source layout as "the `preview` member: `origin` mounts through `preview_mount`/`preview_release`, `inert` sends nothing". Also note that `boot` now requires `preview`.

## Wave gate (orchestrator)
```
Frontend check/lint/test (32)/build passed; cargo xtask ci + snapshot run at the sprint-105 gate (task-005).
```
