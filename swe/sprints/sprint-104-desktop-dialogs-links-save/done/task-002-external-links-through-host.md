# Task 002 — Workbench: external links in messages and Markdown go through the host

- **Sprint:** sprint-104-desktop-dialogs-links-save
- **Status:** done
- **Type:** bugfix
- **Area:** packages/workbench (timeline, host)
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** none

## Goal
Clicking a web link in a chat message or a Markdown file never replaces the app: it goes to the host's `links.openExternal` when there is one, and opens a new tab otherwise.

## Context / why
`FileLink` renders an external link as a bare `<a href>`. A click navigates the page itself: in the web client the app's tab is replaced, and in the desktop window the whole app would be. Only the login dialog's link uses `ExternalAnchor` today.

Repro: with a mock agent, send a message containing `[site](https://example.com)` and click it. Expected: a new tab (web client). Actual: the app's tab navigates away.

## Scope references
- `swe/features/desktop-native-host.md` § Public contract 4 (row "External links")
- `swe/architecture/workbench-host-adapter.md` § Amendment (row "External links")
- `packages/workbench/src/timeline/FileLink.tsx` (the `external` branch), `timeline/file-link-src.ts` (`classifyFileLinkSrc`: empty and fragment-only hrefs are also `external`), `timeline/markdown.tsx`
- `packages/workbench/src/host/external-link.tsx` (`ExternalAnchor`, `routeExternalLinkClick`)
- `packages/workbench/src/features/files/MarkdownFileViewer.tsx` (uses the same `Markdown` component)
- `packages/workbench/AGENTS.md` (file-link rendering)

## What to build
- A pure function that splits what the classifier calls `external` in two: an **in-page** reference (empty, or fragment-only such as `#usage`) and a **URL with a scheme**.
- `FileLink`: a URL with a scheme renders through `ExternalAnchor` (host `openExternal` when present, else `target="_blank"` with `rel="noreferrer"`). An in-page reference keeps today's plain anchor.
- Local file links are untouched.

## Out of scope
- Which schemes may open: the desktop host decides in Rust (task-004). The workbench passes every URL with a scheme to the host.
- Links inside the HTML preview frame.

## Acceptance criteria
- [ ] The function classifies `https://example.com`, `mailto:a@b.c` and `file:///x` as URLs with a scheme, and ``, `#`, `#usage` as in-page.
- [ ] With a test host that has `openExternal`, activating a web link calls it once with the URL and the default action is prevented.
- [ ] With a host that has none, the rendered anchor has `target="_blank"` and `rel="noreferrer"`.
- [ ] A `#section` link is not passed to the host and gets no `target`.
- [ ] In the web client, clicking a web link in a mock message opens a new tab and the app's tab stays.
- [ ] Existing Markdown and file-link tests pass.

## Test / verification plan
- `npx vitest run packages/workbench/src/timeline packages/workbench/src/host`
- `npm run build:workbench`; `npx oxfmt <changed files>`; `npm run lint`
- Browser: mock agent, a message with a web link and a `#fragment` link.

## Notes
- Shared documents: in a parallel wave put `packages/workbench/AGENTS.md` edits in the summary (task-001 edits the same file).
- No DOM test environment in this package: test the pure function and `routeExternalLinkClick`; check rendering in the browser.
