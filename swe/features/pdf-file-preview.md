# PDF File Preview — Scope

> Part of: [MAIN-SCOPE.md](../MAIN-SCOPE.md)
> Related scopes: [html-file-preview.md](html-file-preview.md) (descriptor registry this extends),
> [feature-panels-ui.md](feature-panels-ui.md), [file-explorer-transfer.md](file-explorer-transfer.md),
> [../architecture/viewer-plugin-system.md](../architecture/viewer-plugin-system.md) § Prerequisite
> (the daemon-backed viewer settings this reads)

> **Render stack:** DOM clients only (web-client). Nothing in this feature adds an RPC message, an
> HTTP route, a binary opcode or a feature flag: the bytes arrive over the existing chunked binary
> download path (`useFileDownload`), and the on/off switch is a new **row** in the existing
> `viewer_settings_*` document, whose ids the daemon treats as opaque. The daemon is unchanged.

## Purpose

A `.pdf` in a workspace is classified `binary` today (`viewer-registry.ts`'s `binary` descriptor
lists `pdf`), so opening one shows "No preview available" and a Download button. Agents produce
PDFs routinely — LaTeX builds, generated reports, plotted figures, papers fetched for a task — and
reading one means downloading it and leaving the app. Over the relay (a phone talking to a remote
daemon) there may be no useful place to download it to at all.

This feature renders a PDF **in place**, inside the ordinary `file` tab, as a scrollable stack of
pages with selectable text, a zoom control and a page indicator. It is **on by default** and can be
switched off in Settings → Viewers, which restores today's download-only behaviour.

## Decisions

| Decision | Choice | Why |
|----------|--------|-----|
| Renderer | `pdfjs-dist` (Mozilla pdf.js), lazy-loaded | Renders identically in every supported browser. The native browser PDF plugin (`<iframe src=blob:…>` / `<embed>`) is not an option: Android Chrome does not render PDFs inline at all, iOS Safari renders only the first page in a frame, and the plugin cannot be themed or sized with the pane. Relay/phone use is a first-class path for this app. |
| UI layer | Own component on pdf.js's **core** API (`getDocument`, `page.render`, `TextLayer`) — not pdf.js's `web/pdf_viewer.mjs` | The viewer bundle reads `globalThis.pdfjsLib` at import time (a global side-channel), and ships ~170 KB of CSS styled for Firefox's viewer. The feature needs four things (pages, text selection, zoom, page indicator); the core API covers them directly. |
| Tab shape | A new `ViewerKind` (`"pdf"`) inside the existing `file` tab kind | `packages/web-client/AGENTS.md` § "Adding a file viewer": a dedicated tab kind needs explicit justification. A PDF has no edit/save cycle and no file-less (unbound) mode, so none applies. Tab identity stays `file:<path>`: no change to persisted layout, drag/drop, context menus or `tabFromIdentity`. |
| On/off switch | Viewer-settings row id **`pdfviewer`** | The existing switch, stored on the daemon so windows/devices sharing a daemon agree. `isViewerEnabled(id)` defaults an absent row, an unhydrated store and a capability-free daemon to **enabled**, so "enabled by default" needs no daemon change and no migration. |
| Disabled fallback | `binary` (today's `BinaryFallbackViewer`) | Disabling a viewer moves the file to the plain-file path, never to an error. This matches `packages/web-client/AGENTS.md` § "Viewer-disable gate". |
| Live refresh | **On** | Re-running a LaTeX/report build is the common edit loop. A re-render keeps the scroll position, unlike video (whose refetch restarts playback, which is why video is excluded). |
| Scripting / annotations | Neither: no annotation layer, no form layer, no XFA, no PDF JavaScript (`enableXfa: false`; pdf.js v6 has no `isEvalSupported` option and never evals) | A PDF is untrusted input. Nothing in it may run code or open URLs on the user's behalf. Links inside the PDF are inert in this scope. |

## Public contract

### Viewer registry (`packages/web-client/src/features/files/viewer-registry.ts`)

- `ViewerKind` gains `"pdf"`.
- `ViewerDescriptor` gains an optional **`toggle?: { id: string; fallback: ViewerKind }`**. It names
  the viewer-settings row that gates the descriptor and the kind to render while that row is
  disabled. A descriptor without `toggle` is always on, as every existing descriptor is today.
- New descriptor: `{ kind: "pdf", component: PdfViewer (lazy), extensions: ["pdf"],
  mimePrefixes: ["application/pdf"], liveRefresh: true, toggle: { id: "pdfviewer", fallback:
  "binary" } }`. `"pdf"` is removed from the `binary` descriptor's `extensions`.
- New pure function: `resolveViewerKind(path, isEnabled, opts?) → ViewerKind`. It runs
  `detectViewerKind(path, opts)`; if the detected descriptor has a `toggle` and
  `isEnabled(toggle.id)` is false, it returns `toggle.fallback`. `isEnabled` is injected (the
  `tabFromIdentity` pattern) so the function stays pure and unit-testable.
- `detectViewerKind` itself is unchanged in meaning: it still answers "what kind is this file",
  with no settings involved. `timeline/image-src.ts` keeps calling it, and a `.pdf` still fails
  that gate's `=== "image"` check.

### FilePanel dispatch (`packages/web-client/src/features/files/FilePanel.tsx`)

```
on mount:
    kind = resolveViewerKind(path, isViewerEnabled)     // module-level store read, once per mount
    useFileLiveRefresh(path, cwd, kind)
    render VIEWER_BY_KIND[kind]
```

The kind is resolved **once per FilePanel mount**. A render-time read would switch an open PDF to
the download card when the user flips the toggle, which breaks the "Viewer-disable gate"
invariant: disabling a viewer never touches an already-open tab. Layout replay already waits for
viewer settings to hydrate (`shouldReplayPaneLayout`), so a restored `file:x.pdf` tab resolves
against the real document, not the unhydrated default.

### Settings → Viewers (`packages/web-client/src/features/settings/ViewersPanel.tsx`)

A second row, "PDF Viewer", whose description says that PDF files render in place instead of
offering only a download. It uses the same `Switch`, the same `setEnabled("pdfviewer", …)`, and the
same disabled-reading-on + "Requires a newer daemon" degrade as the Molecule Viewer row. The panel
stays a hardcoded list (its header explains why registry-driven rows wait for the plugin registry).
The two rows become one small constant table rendered by one row component, not two copies.

### PdfViewer component (`packages/web-client/src/features/files/PdfViewer.tsx`)

`PdfViewer({ path, workspaceCwd }: ViewerProps)`, lazy-loaded through the registry like every other
viewer.

| Region | Behaviour |
|--------|-----------|
| Toolbar | Page indicator `current / total`; zoom out / zoom in buttons; a "Fit width" toggle (default on); a zoom percentage readout; a **Download** action (an `<a download>` on the already-fetched object URL, so no second transfer). |
| Page stack | One block per page, in order, sized from the page's own viewport at the current scale before it renders, so the scrollbar is right from the first paint. A page's canvas and text layer are rendered only when the block is near the viewport (IntersectionObserver with a margin of about one screen). Pages that scroll far away release their canvas, which bounds memory on long documents. |
| Text layer | pdf.js `TextLayer` over each rendered canvas. Text is selectable and copyable; it is not a find/search UI. |
| Canvas resolution | The canvas backing store is scaled by `devicePixelRatio` and capped at a maximum pixel area, so a page is crisp on HiDPI screens without allocating an unbounded canvas at high zoom. |

#### Behavior & algorithms

```
load(objectUrl):
    bytes = fetch(objectUrl).arrayBuffer()    // bytes, not the URL: see below
    doc = pdfjs.getDocument({ data: bytes, enableXfa: false,
                              cMapUrl, cMapPacked: true, standardFontDataUrl, wasmUrl, iccUrl })
    sizes = for each page i in 1..doc.numPages: (await doc.getPage(i)).getViewport({scale: 1})
    publish { doc, sizes }                    // one commit: old pages replaced by new in place
    destroy the previous doc, if any

fitWidth scale = (container content width − horizontal padding) / widest page width at scale 1
on container resize while Fit width is on: recompute scale (debounced to animation frames)
zoom in/out: Fit width off; scale = next/previous step on a fixed ladder (e.g. 25%…400%)

current page = the page whose block occupies the vertical midpoint of the scroll container

renderPage(i) when its block becomes near-visible or the scale changes:
    cancel this page's in-flight render task, if any
    render canvas at scale × min(devicePixelRatio, cap); then TextLayer at scale
    a stale render (scale or document changed meanwhile) is cancelled, never painted
```

- **Live refresh.** `liveRefresh: true`. A `file_changed` push invalidates `fileDownload(path)`,
  `useFileDownload` mints a new object URL and `load` runs again. The scroll container is not
  remounted and the new page blocks replace the old ones in one commit, so `scrollTop` survives.
  If the page count shrank, the browser clamps the scroll position.
- **Bytes, not the object URL.** `useFileDownload` revokes an object URL the moment a refresh
  supersedes it, and pdf.js fetches from a URL lazily, so a revoked blob would fail mid-document.
  The viewer reads the bytes once and passes them as `data`.
- **Worker.** pdf.js parses in a dedicated module Worker that Vite bundles through a `?worker`
  import of `pdfjs-dist/build/pdf.worker.min.mjs` (`worker.format: "es"`). Bundling it as a Vite
  worker entry emits a `.js` file, so no static server needs a `.mjs` MIME mapping. The worker is created lazily on first use and handed to pdf.js as
  `GlobalWorkerOptions.workerPort`, shared by every open PDF tab.
- **Lifecycle.** On unmount or document change: cancel render tasks, `doc.destroy()`. The object
  URL is already owned and revoked by `useFileDownload`.

### pdf.js static data assets

pdf.js loads optional data files by URL at runtime. If they are missing, some PDFs misrender
instead of erroring outright:

| Directory (in `pdfjs-dist`) | Option | Needed for |
|-----------------------------|--------|------------|
| `cmaps/` | `cMapUrl` (+ `cMapPacked: true`) | CJK and other CID-keyed fonts that are not embedded |
| `standard_fonts/` | `standardFontDataUrl` | non-embedded standard-14 fonts (Helvetica, Times, …) |
| `wasm/` (minus `quickjs-eval.*`) | `wasmUrl` | JPEG2000 (OpenJPEG), JBIG2 and ICC colour (QCMS) decoding, with the shipped `*_nowasm_fallback.js` |
| `iccs/` | `iccUrl` | CMYK output-intent colour conversion |

They are served under **`<base>/pdfjs/<dir>/…`** by a small plugin in
`packages/web-client/vite.config.ts`. In dev it is middleware that streams the files out of
`node_modules/pdfjs-dist`. In build it emits them into `dist/<target>/pdfjs/`. URLs are built from
`import.meta.env.BASE_URL` resolved against `document.baseURI`, so both the web (`/`) and Electron
(`./`) bases work. `quickjs-eval.*` is excluded because it exists only to run PDF JavaScript, which
this viewer never does. Cost: about 4 MB added to the built `dist` (and so to the `@av-pi-studio/cli`
tarball, which ships it), fetched only by the PDFs that need it. Both static servers
(`packages/cli/src/web-server.ts`, `docker/web-client.nginx.conf.template`) already serve arbitrary
files under `dist`. An unknown extension is `application/octet-stream`, which pdf.js accepts because
it reads these files as bytes.

### Bundle placement (`vite.config.ts` `manualChunks`)

`pdfjs-dist` gets its own named chunk (`vendor-pdfjs`, ~480 KB, not modulepreloaded), the same treatment as `vendor-molviewer`.
Without it, the catch-all `return "vendor"` would merge ~450 KB of pdf.js into the eagerly
modulepreloaded vendor chunk on every page load. `pdfjs-dist` has no runtime dependencies, so a
fixed name cannot pull a subtree back into `vendor` (the failure mode the mermaid comment
describes).

## Data & persistence touchpoints

- `$PI_STUDIO_HOME/viewer-settings.json` may gain a `pdfviewer` row the first time a user flips the
  switch. No row means enabled. The daemon never writes a default row.
- `packages/web-client/package.json` gains `pdfjs-dist` under **devDependencies**, like every other
  web-client runtime library, because the package publishes only its prebuilt `dist`. The committed
  `package-lock.json` is updated with it.

## Error handling & edge cases

| Condition | Expected behaviour |
|-----------|--------------------|
| Download fails | The same error `EmptyState` the other byte viewers show. |
| Not a PDF / corrupt file (`InvalidPDFException`) | "This file could not be opened as a PDF." plus the Download action, which offers the raw bytes. |
| Password-protected (`PasswordException`) | "This PDF is password-protected." plus Download. No password prompt in this scope. |
| Zero-page document | "This PDF has no pages." plus Download. |
| A single page fails to render | That page's block shows a short inline error. Other pages are unaffected. |
| Very large document (hundreds of pages) | Page sizes are fetched once. Only near-visible pages hold canvases. Memory stays bounded by the window, not the page count. |
| Extreme zoom | The canvas pixel area cap keeps allocations bounded. The page draws softer rather than failing. |
| File deleted while open | The live-refresh refetch fails and the viewer shows its download-error state (the same observable outcome as the other live-refresh kinds). |
| Viewer disabled in Settings | Newly opened PDFs use `BinaryFallbackViewer`. Already-open PDF tabs keep rendering until reopened. |
| Daemon without `viewerSettings` | PDFs render (default enabled). The Settings row reads on, disabled, with the "Requires a newer daemon" note. |
| Opened from a diff tab's File toggle | Same dispatch as a file tab, because `FilePanel` is shared. The Diff toggle is unchanged (a binary diff is what git reports). |
| Link annotations inside the PDF | Inert (no annotation layer). Recorded as a non-goal, not a defect. |

## Non-goals

- In-document search/find, outline/thumbnail sidebars, rotation, printing.
- Clickable links or form filling (no annotation/form layer, see the Decisions table).
- Password entry for encrypted PDFs.
- Rendering PDFs inline in chat markdown (`image-src.ts` stays image-only).
- A dedicated `pdf` tab kind or an unbound "new PDF" tab.
- Supporting browsers older than what the modern `pdfjs-dist` build targets (the `legacy/` build
  is not used).

## Dependencies on other specs

- [html-file-preview.md](html-file-preview.md): the descriptor registry, `ViewerProps.workspaceCwd`,
  and the required `liveRefresh` field this adds an entry to.
- [../architecture/viewer-plugin-system.md](../architecture/viewer-plugin-system.md) § Prerequisite:
  `viewer-settings-store.ts`'s `isViewerEnabled`, the replay gate and Settings → Viewers.
- [file-explorer-transfer.md](file-explorer-transfer.md): the binary download path that delivers the
  bytes.

## Acceptance criteria

- [ ] Opening a `.pdf` from the Files tree renders its pages in the file tab, with no download step,
      against a daemon with no `pdfviewer` row (enabled by default).
- [ ] A multi-page PDF scrolls through every page. The page indicator tracks the page at the
      viewport midpoint. Text on a rendered page can be selected and copied.
- [ ] Fit width is the default and follows pane resizes. Zoom in/out changes scale in steps and
      turns Fit width off. Pages re-render crisp at the new scale.
- [ ] Only near-visible pages hold a rendered canvas (verifiable by counting canvases on a long
      document).
- [ ] Rewriting the PDF on disk re-renders it within about a second and keeps the scroll position.
- [ ] A corrupt file, an encrypted file and a download failure each show their message, and each
      offers the Download action where bytes exist.
- [ ] Settings → Viewers lists "PDF Viewer" on by default. Switching it off makes the **next**
      opened PDF show the download card, while an already-open PDF tab keeps rendering. The choice
      survives a reload and reaches a second window without a reload.
- [ ] `pdfjs-dist` lands in its own lazy `vendor-pdfjs` chunk, not the eager `vendor` chunk. A
      production build emits `pdfjs/{cmaps,standard_fonts,wasm,iccs}/` and the worker as a `.js`
      asset. The PDF renders when served by `pi-studio ui` (the CLI's static server), not only by
      the Vite dev server.
- [ ] `detectViewerKind("x.pdf")` is `"pdf"`; `resolveViewerKind("x.pdf", () => false)` is
      `"binary"`; `.zip` and the other binary extensions still resolve to `"binary"`.

## TODO(verify)

- [x] Whether `pdfjs-dist@6`'s modern build passes through Vite 6's default `build.target`
      untouched. **Resolved (sprint-078/task-001):** yes — the production build transforms it with
      no esbuild errors and no new warnings, and the built bundle renders in Chromium.
- [ ] Whether a module Worker from a `file://` origin starts in the Electron target. The Electron
      shell is not currently built (`features/desktop-app.md`), so this is recorded, not blocking:
      pdf.js reports a worker-construction failure as a load error, which the viewer surfaces.
