# Task 003 — `html-sandbox` policy module + `HtmlViewer` + registry entry — Summary

- **Sprint:** sprint-063-html-file-preview
- **Completed:** 2026-08-19T11:35Z
- **Status:** done

## What was implemented

`packages/web-client/src/features/files/html-sandbox.ts` — the pure policy module: frozen
`HTML_SANDBOX_TOKENS` (`["allow-scripts"]`), `HTML_PREVIEW_BLOCKING_CSP`, `PREVIEW_BASE_HREF`, and
`assembleHtmlPreview(source, {assets, blockRemote})`, which (in order) substitutes any supplied
asset refs inside quoted attribute values only, injects the blocking CSP as the first `<head>`
child when requested, and — only when the source declares no `<base>` of its own — injects the
`.invalid` neutralization base plus a fragment-anchor click-interceptor script that keeps in-page
`#` links working under it (see "Fragment-anchor defect" below — this script exists because the
naive base injection alone breaks anchor links). `<head>` detection is case-insensitive and
head-less/`<html>`-less documents get a synthesized `<head>`.

`packages/web-client/src/features/files/HtmlViewer.tsx` + `.module.css` — renders the document via
`useFileSource` (task-002's ladder), with a `Preview | Source` toggle (mirroring
`MarkdownFileViewer`), a "Block remote resources" `Switch`, and a `Reload` button that invalidates
the path's `fileRead`/`fileDownload` queries. The assembled `srcDoc` is `useMemo`'d on exactly
`(content, blockRemote)`. The iframe is **always mounted** once content is available and merely
hidden via inline `display: none` in Source mode — see "Mount-vs-hide defect" below for why a naive
conditional-render ternary was wrong here.

`viewer-registry.ts` — `ViewerKind` gains `"html"`; one new `HtmlViewer` lazy component; one new
`VIEWER_REGISTRY` descriptor (`extensions: ["html", "htm", "xhtml"]`, `liveRefresh: true`).
`viewer-registry.test.ts` gains a live-refresh inclusion assertion for `html` and a
`detectViewerKind` test confirming `html`/`htm`/`xhtml` → `"html"` and `svg` stays `"image"`.

`use-file-live-refresh.test.ts`'s pre-existing exact-set-equality test
(`toEqual(new Set(["text","markdown","image"]))`) was converted to the same inclusion-style pattern
task-001 used elsewhere — see "Pre-existing test defect" below.

Two spec `TODO(verify)` items are resolved with measured outcomes (see "Measurements" below), and
the edge-case table's "in-page anchor link" row is updated with the fix.

## Defects found and fixed during implementation

Two real defects surfaced only once the full sprint's code was integrated and driven in a real
browser — recorded here because both would have shipped silently wrong otherwise:

1. **Fragment-anchor navigation (the spec's own flagged `TODO(verify)`).** Measured in headless
   Chromium: with the injected `.invalid` base, clicking `<a href="#target">` resolves against
   `document.baseURI` (the `.invalid` host) while the sandboxed `srcdoc` frame's `location.href`
   stays `about:srcdoc` — the browser treats this as cross-document navigation, not a same-page
   scroll, and replaces the entire preview with a Chromium network-error page. Fixed by injecting
   `FRAGMENT_ANCHOR_SCRIPT` (a capturing `click` listener on `a[href^="#"]` that `preventDefault()`s
   and scrolls manually) alongside the base — verified before and after: before, `location.href`
   became `chrome-error://chromewebdata/`; after, it stays `about:srcdoc` and `scrollY` moves to the
   target.
2. **Mount/unmount on Preview↔Source toggle (self-introduced, caught by the task's own acceptance
   criterion).** The first draft rendered `{mode === "preview" ? <iframe/> : <CodeView/>}` — a
   ternary that unmounts the iframe entirely in Source mode. Switching back to Preview therefore
   created a **new** iframe element every time, a genuine reload (fresh browsing context) despite
   the memoized `srcDoc` string being byte-identical. Measured: `window.__probe` set inside the
   previewed document did *not* survive a Preview→Source→Preview round trip with the ternary, and
   the DOM node was a different element each time. Fixed by keeping the iframe permanently mounted
   once content is available and toggling only its `display` style; `CodeView` remains conditional
   (it has no persistent state worth keeping). Re-measured after the fix: the same DOM node persists
   across the toggle, and a `window`-level marker survives it (scripts do not re-run) — this is the
   invariant the acceptance criterion actually protects (no double side effects: beacons, chart
   inits, timers). One residual, expected browser quirk: Chromium resets the iframe's own
   `scrollY` to 0 when it becomes `display: none` and visible again, even though the document/script
   state persists — this is not a "reload" in the sense the spec means (no re-execution, no re-fetch)
   and is not covered by any acceptance criterion; noted here for completeness.

## Pre-existing test defect fixed

`use-file-live-refresh.test.ts` had an exact-set-equality assertion
(`expect(new Set(LIVE_REFRESH_KINDS)).toEqual(new Set(["text","markdown","image"]))`) that
task-001 left behind un-converted while correctly writing an *inclusion-style* assertion for the
same set in `viewer-registry.test.ts`. Task-001's own acceptance criterion required inclusion +
exclusion assertions specifically so a later kind addition (this task's `html`) would not force an
edit to a passing test — the exact-equality one broke the moment `html` was added to the
live-refresh set, exposing that the requirement wasn't applied uniformly. Converted it to the same
inclusion pattern; both files now express the identical policy without either being brittle to a
future kind.

## Files created / changed

| File | Change |
|------|--------|
| `packages/web-client/src/features/files/html-sandbox.ts` | created |
| `packages/web-client/src/features/files/html-sandbox.test.ts` | created — 20 tests |
| `packages/web-client/src/features/files/HtmlViewer.tsx` | created |
| `packages/web-client/src/features/files/HtmlViewer.module.css` | created |
| `packages/web-client/src/features/files/viewer-registry.ts` | modified — `html` kind, descriptor, lazy component |
| `packages/web-client/src/features/files/viewer-registry.test.ts` | modified — 2 new tests |
| `packages/web-client/src/hooks/use-file-live-refresh.test.ts` | modified — exact-equality → inclusion assertion (defect fix, see above) |
| `swe/features/html-file-preview.md` | modified — resolved 2 `TODO(verify)` items, updated 1 edge-case row |

## Measurements (resolving the spec's `TODO(verify)` items)

- **Blocking-CSP `data:` coverage** — verified against the exact shipped `HTML_PREVIEW_BLOCKING_CSP`
  string in isolation (headless Chromium, sandboxed `srcdoc` iframe): a `data:`-sourced
  `<link rel="stylesheet">`, a `data:`-sourced classic `<script src>`, and a `data:`-sourced `<img>`
  all load and apply correctly. Confirms `'unsafe-inline'` alone does **not** cover a `data:`-sourced
  element (only a literal inline body) — the explicit `data:` token in `style-src`/`script-src` is
  load-bearing, not redundant. `font-src`/`media-src` share the identical pattern; not independently
  measured (no `@font-face`/`<video>`/`<audio>` fixture in this sprint) but will be exercised for
  real once sprint-064 inlines those asset kinds.
- **Fragment-anchor navigation** — see "Defects found and fixed" above.
- **Full end-to-end pass against a live daemon**, not just isolated CSP/iframe probes: production
  daemon (`node packages/server/dist/daemon/main.js`) + `vite preview` serving the real
  `build:web-client` output, driven via headless browser. Confirmed live in the real app (not a
  synthetic harness):
  - `<iframe>` DOM attributes: `sandbox="allow-scripts"`, `referrerpolicy="no-referrer"`, `allow=""`.
  - Inside the preview: `location.origin === "null"`; `parent.document` and `window.localStorage`
    both throw `SecurityError` (both a scripted probe *inside* the document and a direct
    `page.evaluate` from the test against the frame agree).
  - A same-origin-relative CDN-style script (served from a local static server acting as "remote")
    executes by default; toggling "Block remote resources" blocks that script, a remote image, and
    a `fetch()`, while an inline `<style>` and inline `<script>` keep working (`h1` stays styled,
    `document.title` still gets set).
  - No `<base>` in source → `.invalid` base injected (`document.baseURI` inside the frame reads
    `https://pi-studio-preview.invalid/`).
  - A 6.0 MiB fixture renders via the streamed tier (`"6.0 MB file streamed"` note shown, full
    6,291,641-byte body present inside the iframe). A 31.0 MiB fixture shows the terminal state
    (`"31.0 MB — too large to display (display ceiling is 30.0 MB)"` with a working Download button).
  - Editing the open file on disk re-rendered the preview within ~1.5s with no explicit Reload click
    (`liveRefresh: true` verified live, not just by descriptor inspection).
  - In-page anchor scroll and the Preview↔Source↔Preview stable-mount fix (both above) were also
    verified against this live instance, not just the isolated harness.

## How it satisfies the scope

Every "What to build" bullet is implemented as specified; the two measurement action items
(fragment-anchor, blocking-CSP `data:` coverage) were carried out and their outcomes written back
into `swe/features/html-file-preview.md` per the task's own instruction. No scope was added beyond
the task (local asset inlining, `<style>`/`@import` rewriting, and any daemon change remain
correctly out of scope for sprint-064).

## Build & test results

```
$ npm run typecheck
> tsc -b
(no errors)

$ npm run build:web-client
> tsc -b && vite build
✓ built in 10.06s

$ npx vitest run packages/web-client/src/features/files packages/web-client/src/hooks packages/web-client/src/timeline
 Test Files  29 passed (29)
      Tests  370 passed (370)

$ npx oxfmt --check packages/web-client/src/features/files/html-sandbox.ts packages/web-client/src/features/files/html-sandbox.test.ts packages/web-client/src/features/files/HtmlViewer.tsx packages/web-client/src/features/files/HtmlViewer.module.css packages/web-client/src/features/files/viewer-registry.ts packages/web-client/src/features/files/viewer-registry.test.ts packages/web-client/src/hooks/use-file-live-refresh.test.ts
All matched files use the correct format.

$ npx oxlint <same files>
(no errors, exit 0)
```

Plus the full manual browser pass described under "Measurements" above, against a real production
daemon and the actual `build:web-client` output (not a synthetic/isolated harness) — scratch daemon
home, scratch workspace, and scratch static "CDN" server were all torn down and deleted afterward.

## Acceptance criteria

- [x] Opening an `.html` file shows the rendered document; `Source` shows highlighted source;
      `Preview` is the default. — verified live.
- [x] The iframe carries exactly `sandbox="allow-scripts"`, `referrerpolicy="no-referrer"` and an
      empty `allow` attribute — verified in the live DOM.
- [x] Inside the preview, `location.origin === "null"`, and both `parent.document` and
      `localStorage` throw — checked in a real browser session (see Measurements).
- [x] A document with a CDN-style `<script src>` executes by default; with "Block remote resources"
      on, that script, a remote image and a remote `fetch` are all blocked while inline script/style
      still run — verified live (real internet egress was unavailable in the sandboxed CI
      environment, so a local static server stood in for "remote"; the CSP mechanism being tested is
      origin-agnostic).
- [x] A document with no `<base>` gets the `.invalid` base injected; a document declaring its own
      `<base href>` is left untouched — unit-tested (`html-sandbox.test.ts`) and verified live.
- [x] An `.html` file over 5 MiB renders via the streamed tier — verified live with a 6.0 MiB fixture.
- [x] Editing the open file on disk re-renders the preview within ~1s — verified live (~1.5s).
- [x] Clicking an in-page anchor scrolls the preview; it does not navigate the frame to the
      `.invalid` host — measured broken, then fixed (see Defects); re-verified working after the fix.
- [x] Toggling theme or switching Preview → Source → Preview does not reload the preview document
      (stable `srcdoc` identity) — measured broken with the initial ternary-based mount, fixed by
      keeping the iframe permanently mounted; re-verified: DOM node identity and in-page script
      state both survive the toggle.
- [x] `html-sandbox.test.ts` passes, including the never-`allow-same-origin` guard — 20/20.
- [x] `npm run build:web-client` and `npm run typecheck` pass.

## Follow-ups / TODO(verify)

- `font-src`/`media-src` `data:` coverage under the blocking CSP: same pattern as the measured
  `style-src`/`script-src`/`img-src` channels, not independently exercised in this sprint (no
  `@font-face`/media fixture existed to test). Will be exercised for real once sprint-064's asset
  loader starts inlining fonts and media; flagged there if it doesn't hold.
- Non-Chromium (Firefox/Safari) parity remains unverified, as already noted in the spec — the app
  ships Chromium-first (Electron shell).
- The two fixture files used for the >5 MiB / >30 MiB streamed/terminal-tier check were generated
  synthetic padding (not a "real" report); this exercises the size ladder correctly but is not a
  representative multi-file report — sprint-064/task-003's verification pass is where a realistic
  multi-asset fixture belongs.
