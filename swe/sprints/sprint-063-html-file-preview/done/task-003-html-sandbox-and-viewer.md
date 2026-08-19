# Task 003 — `html-sandbox` policy module + `HtmlViewer` + registry entry

- **Sprint:** sprint-063-html-file-preview
- **Status:** done
- **Type:** feature
- **Area:** web-client / features/files
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** task-001, task-002

## Goal
Render an `.html` file inside the Files panel in an isolated sandboxed iframe, with a Preview/Source
toggle, a "Block remote resources" switch, and a base-URL injection that keeps un-inlined refs off
the app origin — registered as one descriptor entry.

## Context / why
An `.html` file opens as source today. Agents produce HTML constantly (coverage reports, benchmark
dashboards, plots, exported diagrams), and reading one means leaving the app — impossible when the
daemon is a remote box reached over the relay.

The isolation requirement is not theoretical: the app's origin holds the daemon password and
connection state in `localStorage` (`providers/kv-store.ts`) plus a live authenticated WebSocket, so
a previewed document executing in the app's origin would be a full credential compromise. Measured
in headless Chromium on 2026-08-19 (see `swe/features/html-file-preview.md` § Browser platform
constraints): with `sandbox="allow-scripts"` and **no** `allow-same-origin`, the child's origin is
`"null"` and both `parent.document` and `localStorage` throw `SecurityError`.

Two other measured facts drive the shape of this task:
- **`srcdoc`'s `baseURI` is the parent document's URL.** An un-rewritten relative ref would therefore
  fetch the SPA's `index.html` (nginx history fallback answers 200 `text/html`) — a silently wrong
  response rather than a clean failure. Hence the injected `.invalid` base.
- **A `<meta http-equiv="Content-Security-Policy">` inside the document is a working network lever**
  (remote img/script/fetch all blocked; inline and `data:` unaffected). Product decision: remote
  loading is **allowed by default** (CDN-based reports are the common case), with blocking as an
  explicit per-tab toggle.

## Scope references
- `swe/features/html-file-preview.md` § Preview document assembly, § Network policy,
  § Base-URL neutralization, § Toolbar & registration, § Browser platform constraints
- `packages/web-client/src/features/files/viewer-registry.ts` (one new descriptor)
- `packages/web-client/src/features/files/MarkdownFileViewer.tsx` (toolbar/toggle pattern to mirror)
- `packages/web-client/src/features/files/CodeView.tsx` (Source mode)
- `packages/web-client/src/hooks/use-file-source.ts` (task-002)
- `packages/web-client/src/components/primitives/` (`Button`, `EmptyState`, `Spinner`, `Switch`)

## What to build
- New `packages/web-client/src/features/files/html-sandbox.ts` (pure, no React):
  ```ts
  export const HTML_SANDBOX_TOKENS: readonly string[];      // ["allow-scripts"]
  export const HTML_PREVIEW_BLOCKING_CSP: string;           // default-src 'none' + data:/inline allowances
  export const PREVIEW_BASE_HREF: string;                   // "https://pi-studio-preview.invalid/"
  export function assembleHtmlPreview(
    source: string,
    opts: { assets?: Readonly<Record<string, string>>; blockRemote: boolean },
  ): string;
  ```
  `assembleHtmlPreview` in this task performs: optional meta-CSP injection as the first `<head>`
  child (or a synthesized `<head>` when the document has none), `<base>` injection **only** when the
  source declares no `<base>` of its own, and a no-op pass for `assets` (populated in sprint-064 —
  accept and apply the substitution map now so the seam exists, but do not add extraction logic).
  Doc-comment the two invariants: never `allow-same-origin`, and the CSP is a *network* policy, not
  the isolation boundary.
- **Fragment-anchor measurement (spec TODO(verify)):** with a foreign `<base>`, `<a href="#…">` may
  attempt a frame navigation to the `.invalid` host instead of scrolling. Measure it; if broken,
  handle it in assembly (rewrite fragment-only hrefs, or a base form that preserves same-document
  fragment navigation), record the measurement, and update the spec's edge table with the outcome.
- New `html-sandbox.test.ts`: `HTML_SANDBOX_TOKENS` contains `allow-scripts` and **never**
  `allow-same-origin`, `allow-top-navigation`, `allow-top-navigation-by-user-activation` or
  `allow-popups`; CSP injected only when `blockRemote`; base injected only when absent from source;
  `<head>`-less and uppercase-`<HEAD>` documents handled; a supplied `assets` map substitutes.
- New `HtmlViewer.tsx` + `HtmlViewer.module.css`: `useFileSource(path)` for the document; local
  `mode: "preview" | "source"` (default `preview`) and `blockRemote` (default `false`) state; toolbar
  = `Preview | Source` buttons (mirroring `MarkdownFileViewer`'s), a "Block remote resources"
  control, and Reload (invalidate this path's queries). Preview renders
  `<iframe sandbox={HTML_SANDBOX_TOKENS.join(" ")} srcDoc={assembleHtmlPreview(...)}
  referrerPolicy="no-referrer" allow="" className={styles.frame} title={basename} />`; Source renders
  `CodeView`. Loading/error/too-large states come from the hook.
- Memoize the assembled `srcdoc` on (source, blockRemote): its string identity must not change on
  unrelated re-renders (theme, pane layout, Preview/Source toggle-and-back) — React re-setting
  `srcDoc` reloads the document and re-runs its scripts.
- Registry: one descriptor — `kind: "html"`, `extensions: ["html", "htm", "xhtml"]`,
  `liveRefresh: true`, lazy component; extend the registry test's derived live-refresh inclusion
  assertions with `html`. `ViewerKind` gains `"html"`. `svg` stays `image`.

## Out of scope
- Local asset inlining and the not-inlined note (sprint-064) — a document referencing `./style.css`
  renders unstyled in this sprint, which is the pre-existing baseline, not a regression.
- Persisting the Preview/Source or network choice.
- Any daemon/protocol change (including the missing `.html`/`.css`/`.js` entries in the server's
  `mimeHintForFile`).
- Intercepting in-document navigation / multi-page browsing.

## Acceptance criteria
- [ ] Opening an `.html` file shows the rendered document; `Source` shows highlighted source;
      `Preview` is the default.
- [ ] The iframe carries exactly `sandbox="allow-scripts"`, `referrerpolicy="no-referrer"` and an
      empty `allow` attribute (verified in the live DOM).
- [ ] Inside the preview, `location.origin === "null"`, and both `parent.document` and
      `localStorage` throw — checked in a real browser session, recorded in the summary.
- [ ] A document with a CDN `<script src="https://…">` executes by default; with "Block remote
      resources" on, that script, a remote image and a remote `fetch` are all blocked while inline
      script/style still run.
- [ ] A document with no `<base>` gets the `.invalid` base injected; a document declaring its own
      `<base href>` is left untouched.
- [ ] An `.html` file over 5 MiB renders via the streamed tier (task-002).
- [ ] Editing the open file on disk re-renders the preview within ~1s (`liveRefresh: true`).
- [ ] Clicking an in-page anchor (`<a href="#…">`) scrolls the preview; it does not navigate the
      frame to the `.invalid` host (or, if measurement proves this unfixable without regressing base
      neutralization, the limitation + measurement are recorded in the spec's edge table).
- [ ] Toggling theme or switching Preview → Source → Preview does not reload the preview document
      (stable `srcdoc` identity).
- [ ] `html-sandbox.test.ts` passes, including the never-`allow-same-origin` guard.
- [ ] `npm run build:web-client` and `npm run typecheck` pass.

## Test / verification plan
- Unit: `npx vitest run packages/web-client/src/features/files`.
- Manual (real browser, per project convention — no jsdom): serve the built web-client against a
  production daemon; open a fixture `report.html` containing inline CSS/JS, a CDN script, a remote
  image, and a `parent.document` probe that writes its result into the document body. Confirm: render
  correct, probe reports blocked access, CDN script ran. Toggle "Block remote resources": CDN script
  and remote image blocked, inline still fine. Toggle Source: highlighted source. Edit the file from
  a terminal: preview updates.
- Build/typecheck as above.

## Notes
Do **not** reach for object URLs anywhere in this viewer: a sandboxed opaque-origin document cannot
fetch a parent-created `blob:` URL (measured — `Failed to fetch`). `data:` is the only inlining
vehicle, which is why sprint-064 inlines rather than rewrites to blobs.
