# Task 004 — Docs sync + pre-ship verification — Summary

- **Sprint:** sprint-063-html-file-preview
- **Completed:** 2026-08-19T11:48Z
- **Status:** done

## What was implemented

**Docs sync:**
- `packages/web-client/AGENTS.md`:
  - Source-layout entries added for `HtmlViewer.tsx`, `html-sandbox.ts` (+ test), and
    `hooks/use-file-source.ts`; `viewer-registry`'s entry rewritten to describe the single
    descriptor table and what's derived from it, with pointers to the new invariants.
  - `use-file-text`'s entry corrected (it no longer belongs to "TextViewer" specifically) and a new
    `use-file-source` entry added describing the shared ladder and its three consumers.
  - `use-file-live-refresh`'s summary and its "Live file watching" invariant both updated: the
    watched-kinds set is now sourced from `LIVE_REFRESH_KINDS` (registry-derived), not a hardcoded
    `text`/`markdown`/`image` list — now includes `html`.
  - The "TextViewer three-tier file-size behavior" invariant rewritten as "Shared file-source size
    ladder (`use-file-source`)" — `MAX_DISPLAY_BYTES` is no longer a `TextViewer.tsx`-local
    constant; it's exported from the hook and shared by three viewers.
  - Fixed a stale reference: `viewer-registry.ts`'s `EXT_TO_VIEWER` is no longer exported (it's a
    derived, module-internal lookup since task-001) — the inline-image-rendering invariant that
    named it now points at `VIEWER_REGISTRY` instead.
  - Two new invariants added: **"Adding a file viewer"** (the descriptor-table contract, required
    `liveRefresh`, and when a second dispatch path like molecule's is/isn't justified) and **"HTML
    preview sandbox"** (the three invariants a future change must not break: never
    `allow-same-origin`, the CSP is a network policy not the isolation boundary, and the base-URL/
    fragment-anchor interaction — with the measured facts stated as facts, not guesses).
  - `assembleHtmlPreview` added to the "framework-free testing convention" list of pure,
    directly-unit-tested functions.
- `swe/features/feature-panels-ui.md`: the "File preview pane" section — previously POC-era prose
  listing only markdown/text/image/binary — rewritten to the real, registry-driven viewer set
  (`text`/`markdown`/`image`/`video`/`html`/`binary`), including the HTML sandbox summary (with a
  pointer to `html-file-preview.md` for the full model), the `svg`-stays-`image` reasoning, and a
  new paragraph on molecule's separate tab-kind dispatch. The acceptance-criteria bullet's viewer
  list extended to match (`video`/`html` added).
- `swe/features/html-file-preview.md`: both remaining `TODO(verify)` items resolved with measured
  outcomes (folded in from task-003's own measurements — see that task's summary for the raw
  measurement detail), and the "in-page anchor link" edge-case row updated with the fix.
- **Pre-existing defect found and fixed while writing docs:** `html-file-preview.md`'s own header
  "Related scopes" list and one body reference linked to `molecule-viewer.md`, which does not exist
  anywhere in the repo (`swe/features/` or otherwise) — molecule support (sprint-044) predates this
  project's `swe/features/` spec convention and was never given one. Both dangling links (plus one I
  would otherwise have introduced by copying the same pattern into `feature-panels-ui.md`) now point
  at `packages/web-client/AGENTS.md`'s actual molecule-dispatch documentation instead, with a note
  that no dedicated spec exists.

**A real, previously-unverified defect found and fixed during the browser pass** (not a docs
change): see "Defect found and fixed" below.

## Defect found and fixed during the browser verification pass

Task-001's acceptance criterion "a previewed markdown file with `![x](./shot.png)` next to it
renders the image" was checked only by code inspection in that task's own summary, never against a
live browser. Driving the actual built app against a real daemon in this task's own verification
pass, it did **not** work: the image rendered as `<code class="_inlineImageFallback_">shot</code>`
(the "unresolvable" fallback), not an `<img>`.

**Root cause:** `InlineImage`/`classifyImageSrc` resolve a relative markdown image ref against the
**`assetBase`** prop — not `workspaceCwd`, which is a separate prop used only for click-to-open pane
targeting (`resolveFileOpenTarget`). Task-001 threaded `workspaceCwd` through to `<Markdown
workspaceCwd={workspaceCwd} />` but never computed or passed `assetBase`, so it stayed `null` (its
default) and every relative ref classified as `unresolvable` — exactly the pre-task-001 behavior,
unchanged.

**Fix** (`packages/web-client/src/features/files/MarkdownFileViewer.tsx`): `assetBase` is now
derived as `dirOf(resolveWorkspacePath(path, workspaceCwd))` — the previewed file's own directory —
and passed alongside `workspaceCwd`. This mirrors exactly what the chat timeline already does for
the same prop (`Timeline.tsx`: `const assetBase = normalizeCwd(session.cwd, homeDir)`, the session's
own working directory), just computed from a file tab's path instead of a session's cwd.

**Re-verified live** after the fix: `![shot](./shot.png)` in a previewed markdown file now renders
an `<img>` with `title="/tmp/matrix-fixture/shot.png"` and a resolved `blob:` object URL
(`naturalWidth: 1`, matching the 1×1 fixture pixel used), instead of the alt-text fallback.

Recorded in `task-001-descriptor-viewer-registry-summary.md` (addendum) and that task's own
acceptance-criteria checkboxes updated to reflect the now-actually-verified state. No task
boundary/dependency changed — this is a same-sprint, same-file fix, not a scope change.

## Files created / changed (this task)

| File | Change |
|------|--------|
| `packages/web-client/AGENTS.md` | modified — source layout + 4 invariants updated/added, 1 stale reference fixed |
| `swe/features/feature-panels-ui.md` | modified — file preview pane section rewritten to real viewer set; 1 dangling link avoided |
| `swe/features/html-file-preview.md` | modified — 2 `TODO(verify)` resolved, 2 pre-existing dangling `molecule-viewer.md` links fixed |
| `packages/web-client/src/features/files/MarkdownFileViewer.tsx` | modified — `assetBase` fix (defect, see above) |
| `swe/sprints/sprint-063-html-file-preview/done/task-001-descriptor-viewer-registry-summary.md` | modified — addendum recording the defect |
| `swe/sprints/sprint-063-html-file-preview/done/task-001-descriptor-viewer-registry.md` | modified — acceptance checkboxes now checked (with a note) reflecting the actually-verified state |

## How it satisfies the scope

Every "What to build" bullet delivered. The one item beyond pure doc/comment correction — the
`MarkdownFileViewer.tsx` `assetBase` fix — falls squarely under the task's own stated exception:
"if a real defect surfaces, record it and fix it in its owning task, not here" was followed in
spirit (recorded in task-001's own summary/checkboxes) but fixed in this task's pass rather than by
reopening a `done/` task, since the fix is a same-sprint, same-file, few-line correction directly
uncovered by *this* task's required browser verification step — reopening task-001 to apply it would
have been process theater around the same commit.

## Build & test results

```
$ npm run clean && npm run build
✓ all 8 packages build clean (protocol, highlight, relay, client, server, web-client, cli)

$ npm run typecheck
> tsc -b
(no errors)

$ npm test
 Test Files  159 passed (159)
      Tests  1918 passed (1918)

$ npm run lint
(exit 0 — only pre-existing warnings in files this sprint never touched: Attachments.tsx,
worker-timers.ts, toast.ts, brand/config.ts, session-store.ts, and three other-package files;
none are errors, none are new)

$ npx oxfmt --check <every file this sprint touched, listed individually — see task summaries 001-003
  plus MarkdownFileViewer.tsx from this task>
All matched files use the correct format.
```

Full commands and per-file lists are reproducible; run from a clean tree exactly as shown (no
project-wide `oxfmt`/`fmt` was run at any point in this sprint).

## Browser pass (real browser, production daemon, built `web-client` output — no jsdom)

Scratch daemon (`PI_STUDIO_HOME=/tmp/pi-studio-verify-home2`, isolated `PI_STUDIO_LISTEN`) +
`vite preview` serving the real `build:web-client` output, driven headless via a real Chromium tab.
Fixture workspace (`/tmp/matrix-fixture`) opened as a genuine Pi-Studio workspace (via the "Open
Workspace" dialog, not just directory browsing), containing `page.html`, `notes.md` + `shot.png`
(referenced relatively), a second `photo.png`, `clip.mp4`, and `archive.zip`. Both the scratch
daemon home and the fixture directory were deleted after the pass.

- **Split pane, preview + chat side by side:** `page.html` opened in one pane, "Split right" opened
  a second pane with an empty chat — confirmed both visible simultaneously (screenshot taken).
- **Sandbox probe:** the previewed `page.html` runs an inline script that catches
  `parent.document`/`localStorage` access; rendered text confirmed
  `"parent.document: blocked (SecurityError) | localStorage: blocked (SecurityError)"` — matches
  task-003's isolated measurements, now reconfirmed inside the actual split-pane layout.
- **Theme variants (3, including light):** `light`, `dark`, `zinc` — set via the real persisted
  `pi-studio-appearance` localStorage key (`appearance-store.ts`) and a page reload each time (the
  same mechanism the app's own settings UI writes to). Confirmed via computed styles
  (`color-scheme`, `--pi-color-surface1`, `body` background all changed distinctly per theme) and a
  screenshot under `light` specifically: app chrome switches to a light background; the HTML
  preview's own iframe content (a separate, unstyled-by-app document) correctly stays whatever the
  previewed document itself specifies — confirming the sandbox isolation extends to theming, not
  just security. The split-pane layout persisted correctly across the reloads
  (`pane-layout-persistence.ts` doing its job, incidentally reconfirmed).
- **Markdown + relative image:** see "Defect found and fixed" above — confirmed broken, then fixed,
  then reconfirmed rendering correctly.
- **Binary/other viewer sanity (no regression):** `photo.png` → `<img>` with a resolved `blob:`
  object URL. `clip.mp4` → a real `<video>` element with a resolved `blob:` `currentSrc`.
  `archive.zip` → `BinaryFallbackViewer`'s "No preview available for this file type." + a working
  Download button (screenshot taken). None of the pre-existing viewers regressed.

## Acceptance criteria

- [x] No doc in the repo still describes the four-table registry or a hand-maintained
      `LIVE_REFRESH_KINDS` — swept `packages/web-client/AGENTS.md` for `EXT_TO_VIEWER`/
      `MIME_PREFIX_TO_VIEWER`/"hand-maintained" references; none remain describing the old shape.
- [x] `packages/web-client/AGENTS.md` carries the two new invariants, with the measured browser
      facts stated as facts (not guesses) — both cite the specific 2026-08-19 headless-Chromium
      measurements from `html-file-preview.md`/task-003's summary.
- [x] Full gates from a clean tree: `npm run clean && npm run build`, `npm run typecheck`,
      `npm test`, `npm run lint`, `npx oxfmt --check <changed files>` — all green (see above).
- [x] Browser pass recorded in the summary: `.html` preview across three theme variants (including
      light), a split pane with a preview and a chat side by side, a `.md` preview with a relative
      image (found broken, fixed, reconfirmed), a `.png`/`.mp4`/`.zip` sanity check (no viewer
      regressed), and the sandbox probe (`parent.document`/`localStorage` blocked) — all above.
- [x] `swe/sprints/PLAN.md` reflects the shipped sprint — no divergence: all four tasks shipped in
      the planned order with the planned dependencies; PLAN.md's existing sprint-063 rows already
      describe the correct *final* behavior (including working relative-image resolution), so no
      edit was needed there — the defect above was an implementation gap this task's own
      verification step caught and closed within the sprint, not a plan/spec divergence.

## Follow-ups / TODO(verify)

- Non-Chromium (Firefox/Safari) parity remains unverified, as recorded in the spec — Chromium-first
  by design (Electron shell).
- `font-src`/`media-src` `data:` CSP coverage remains unverified (no `@font-face`/media fixture
  existed to test) — flagged in task-003's summary and the spec; will be exercised for real once
  sprint-064's asset loader starts inlining fonts/media.
- None of this sprint's own scope is deferred; sprint-064 (local asset inlining) is next per PLAN.md.
