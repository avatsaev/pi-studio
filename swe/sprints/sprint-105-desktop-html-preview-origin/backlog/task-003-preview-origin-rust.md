# Task 003 — Rust: the preview origin (document store, scheme handler, commands, policy)

- **Sprint:** sprint-105-desktop-html-preview-origin
- **Status:** backlog
- **Type:** feature
- **Area:** desktop/crates/shell, desktop/apps/pistudiodesktop/src-tauri
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** task-001, sprint-104/task-007

## Goal
The app serves previewed HTML documents from an origin of its own, with headers that isolate them, and the page can mount and release a document. The boot snapshot says whether this platform can do it.

## Context / why
D7. A document on another origin is governed by its own response headers instead of the window's policy, so its scripts can run while the `sandbox` attribute and header keep it away from the app.

## Scope references
- `swe/features/desktop-native-host.md` § HTML preview origin, § Public contract 6 (policy row), § Error handling (preview rows)
- `swe/notes/desktop-preview-origin-spike.md` (task-001: the URL form, the `frame-src` source, the per-platform table)
- `desktop/crates/shell/src/` (a new module for the document store)
- `desktop/apps/pistudiodesktop/src-tauri/src/` (`main.rs`, page commands), `build.rs`, `capabilities/default.json`, `tauri.conf.json` (`app.security.csp`)
- `desktop/docs/architecture.md` § The webview boundary (the policy table)

## What to build
- **Document store in the shell crate**, tested: mount(html) → an id of 128 random bits in hex; get(id); release(id); clear. At most 32 documents and 32 MiB in total; a mount beyond either is refused.
- **Scheme handler** for the origin the spike settled on: `GET` of a mounted id answers the document with
  `Content-Type: text/html; charset=utf-8`, `Content-Security-Policy: sandbox allow-scripts`, `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`. Any other path, id or method answers 404.
- **Platform table:** one function says `origin` or `inert` for the running platform, from the spike's results. A platform that was not measured is `inert`.
- **Boot snapshot** gains `preview: "origin" | "inert"`. `boot` also clears the store, so documents do not outlive a page reload.
- **Page commands**, added to the command list and the capability file:
  | Command | Input | Answer |
  |---|---|---|
  | `preview_mount` | `{ html }` | `{ url }` (built in Rust, in this platform's URL form). An error on an `inert` platform or when a cap is hit |
  | `preview_release` | `{ url }` | nothing; an unknown URL is ignored |
- **Policy:** add the preview origin to `frame-src` in `tauri.conf.json`, in the form(s) the spike measured. The origin appears in no capability.

## Out of scope
- The workbench viewer (task-002) and the frontend member (task-004).
- Serving anything but mounted documents from this origin.

## Acceptance criteria
- [ ] The store refuses a 33rd document and a mount that would pass 32 MiB; released space is reusable.
- [ ] Ids are 32 hex characters and two mounts never collide in a test of 10,000.
- [ ] A handler test (or the handler's pure core) returns the four headers for a mounted id and 404 for an unknown id, another path and a `POST`.
- [ ] After `boot`, a previously returned URL answers 404.
- [ ] On a platform the table marks `inert`, `preview_mount` is an error and the snapshot says `inert`.
- [ ] `npm run snapshot` reports no policy violation with the new `frame-src`.
- [ ] `cargo xtask ci` passes.

## Test / verification plan
- `cargo test -p pistudiodesktop-shell`
- `cargo xtask web && cargo xtask ci` in `desktop/`
- `npm run build && npm run snapshot` in `desktop/apps/pistudiodesktop`
- Scripts running and isolation are observed in task-005.

## Notes
- If task-001 found that a custom scheme cannot work and another origin is needed, re-read the spec section with the notes before starting; if neither alternative worked, this task is blocked.
- Depends on sprint-104/task-007 because the same app files change (`main.rs`, the command list, the capability file).
- **Found at planning time:** the spec's boot snapshot has no `preview` field. Rust knows the platform and the table, so the snapshot carries the kind; sprint-106/task-003 records it in the spec.
- The document is untrusted (written by an agent). It is never logged.
