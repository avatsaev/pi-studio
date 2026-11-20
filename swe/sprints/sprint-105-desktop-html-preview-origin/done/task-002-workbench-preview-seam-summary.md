# Task 002 — Workbench: the HTML viewer uses `host.preview` when the host has one — Summary

- **Sprint:** sprint-105-desktop-html-preview-origin
- **Completed:** 2026-11-20
- **Status:** done, except the browser check. I skipped it, as instructed; the orchestrator does it.

## What was implemented
- **Host type:** `HostPreview` is `{ kind: "origin"; mount(html) → Promise<{ url; release() }> }` or `{ kind: "inert" }`. `WorkbenchHost` gains an optional `preview?: HostPreview`, and the type is exported from `src/index.ts`.
- **Bookkeeping module:** `preview-mounts.ts` is pure.
  - A newer settled document releases the previous one exactly once.
  - A mount that resolves after it was superseded, or after `dispose`, is released at once.
  - `dispose` releases the current document and makes in-flight mounts stale. It can be called again after an effect re-run.
- **`HtmlViewer`, `origin`:** it mounts the assembled `srcDoc`, the same string that `assembleHtmlPreview` produced.
  - It mounts only once the asset bundle has settled, so the single-load rule holds.
  - The frame uses `src={url}` with the same `SANDBOX` tokens and stays mounted across Preview/Source switches.
  - While the first mount is pending the body shows a spinner, and the previous URL stays in the frame while a newer document mounts.
  - Unmounting calls `dispose`.
  - A rejected mount shows `EmptyState` "Error: …" in the body. The toolbar stays, so Source still works.
- **`HtmlViewer`, `inert`:** the `srcDoc` frame is unchanged, with a `.inertNote` line above it: "Scripts are disabled in the desktop app on this platform."
- **`HtmlViewer`, absent:** the same `srcDoc` frame as before. `assembleHtmlPreview` and `HTML_SANDBOX_TOKENS` are untouched.
- **Test host:** `createTestHost({ preview: "inert" | "origin" | { mountFails } })`. Origin mounts and releases are recorded as `preview.mount` and `preview.release`.

## Files
| File | Change |
|---|---|
| `packages/workbench/src/features/files/preview-mounts.ts` | new |
| `packages/workbench/src/features/files/preview-mounts.test.ts` | new, 4 tests |
| `packages/workbench/src/features/files/HtmlViewer.tsx` | changed |
| `packages/workbench/src/features/files/HtmlViewer.module.css` | changed (`.inertNote`) |
| `packages/workbench/src/host/types.ts` | changed (`HostPreview`, `preview?`) |
| `packages/workbench/src/index.ts` | changed (export) |
| `packages/workbench/src/test/test-host.ts` | changed (`preview` option) |
| `packages/workbench/src/host/host-members.test.ts` | changed (3 tests) |

## Build & test results
- `npx vitest run packages/workbench/src/features/files packages/workbench/src/host`: 20 files and 252 tests pass.
- `npm run build:workbench` and `npm run build:web-client` build; I saw no errors in the output.
- `desktop/apps/pistudiodesktop` `npm run check` (`tsc -b`) is clean.
- `oxfmt` reports all changed files correctly formatted.
- `oxlint` reported one unused `useRef` import in `HtmlViewer.tsx`, which I removed. I did not re-run vitest or the web-client build after that last edit; I did re-run `oxlint`, `oxfmt --check` and `build:workbench` on it.

## Acceptance criteria
- [x] Mount B while A is mounted releases A once; unmount releases the current one; a late mount is released at once. Covered by `preview-mounts.test.ts`.
- [x] `HTML_SANDBOX_TOKENS` is unchanged and its guard test passes.
- [x] The document handed to `mount` is `srcDoc` as produced by `assembleHtmlPreview`, by construction. There is no DOM test for it.
- [ ] The web client (no `preview`) previews an HTML file with an inline script as before, and "Block remote resources" works. The code path is the old `srcDoc` frame, but I did not check it in a browser. **For the orchestrator.**
- [x] The package builds and its tests pass.

## Follow-ups
- Browser check in the web client.
- Host implementation (task-004) and Rust origin (task-003) are out of scope.

## Proposed doc edits
**`packages/workbench/README.md` § The host:** add this row to the optional-members table.
> `preview?` — `HostPreview`: `{ kind: "origin", mount(html) → Promise<{ url, release() }> }` makes the HTML viewer load its frame from the returned `url` instead of `srcdoc` (same sandbox tokens; `release` is called when a newer document replaces it and on unmount; a rejected `mount` shows the viewer's error state), or `{ kind: "inert" }` keeps `srcdoc` and shows "Scripts are disabled in the desktop app on this platform." Absent: the `srcdoc` frame, unchanged.

**`packages/workbench/AGENTS.md`:**
- Host members: the same row as above.
- HTML preview invariants: add this paragraph.
> With a `host.preview` of kind `origin`, `HtmlViewer` mounts only a settled document (never the assetless intermediate of the single-load rule) and loads the always-mounted frame via `src`. The mount/release bookkeeping lives in the pure `features/files/preview-mounts.ts`. The sandbox tokens are unchanged.
- Source layout: add `preview-mounts.ts` (pure: current mounted preview document, release on supersede, dispose).
- Testing: add `preview-mounts.test.ts`.

## Wave gate (orchestrator)
```
npx vitest run packages/workbench: 119 files / 1517 tests passed; build:workbench OK; build:web-client OK; oxlint on changed files clean. README + AGENTS host rows updated by the orchestrator. Browser check of the web-client preview runs in sprint-105/task-005.
```
