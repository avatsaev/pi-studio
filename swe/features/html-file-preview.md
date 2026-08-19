# HTML File Preview (Sandboxed Iframe) — Scope

> Part of: [MAIN-SCOPE.md](../MAIN-SCOPE.md)
> Related scopes: [feature-panels-ui.md](feature-panels-ui.md),
> [file-explorer-transfer.md](file-explorer-transfer.md),
> [file-link-rendering.md](file-link-rendering.md),
> [inline-image-rendering.md](inline-image-rendering.md),
> [workspace-ui.md](workspace-ui.md),
> [../architecture/client-app-runtime.md](../architecture/client-app-runtime.md),
> [../architecture/design-system.md](../architecture/design-system.md)

> **Render stack:** DOM clients only — web-client today, plus the Electron shell once
> sprint-033-desktop hosts the same bundle. Nothing in this feature adds an RPC message type, an
> HTTP route, or a new binary opcode: the document arrives over the existing `file_read_request` /
> chunked binary download paths, and every asset over the same binary download path. The daemon is
> unchanged.

> **Second half of a generalization.** The viewer registry
> (`packages/web-client/src/features/files/viewer-registry.ts`) was built so "adding a new file type
> is one entry" — in practice it is four edits across two directories, and one of them
> (`LIVE_REFRESH_KINDS` in `hooks/use-file-live-refresh.ts`) is silently defaulted when forgotten.
> HTML is the first new viewer since molecule support, so this scope covers **both** the registry
> generalization that makes future viewers genuinely one entry and the HTML viewer itself.

## Purpose

An `.html` file in a workspace opens in the text viewer today: source, no render. Agents routinely
produce HTML — coverage reports, benchmark dashboards, plotted results, exported diagrams, scraped
pages — and reading them means leaving the app (`open file://…` in another browser, if the file is
even on the same machine as the browser; over the relay it is not).

This feature renders an HTML file **in place**, inside the Files panel, in an iframe that is
isolated from the app: it cannot read the app's DOM, its `localStorage` (which holds the daemon
password and connection state), or its live WebSocket. Relative local assets the document references
(`./style.css`, `./app.js`, `./logo.png`) are resolved through the daemon and inlined, so a
multi-file report renders as authored rather than as unstyled text with broken images.

It also fixes a pre-existing defect discovered while scoping: `MarkdownFileViewer` renders a
previewed `.md` file's markdown with **no asset base**, so relative images in a previewed markdown
file never resolve. The cause is the same one that would block HTML — a viewer receives only `path`
and cannot know its workspace — so it is fixed once, in the registry contract, for both.

## Browser platform constraints (measured, not assumed)

Every design decision below follows from behavior measured on 2026-08-19 in headless Chromium
(parent document on a real `https` origin, child `<iframe sandbox="allow-scripts">`, no
`allow-same-origin`). These are contractual inputs, not implementation trivia:

| Probe | Result | Consequence |
|-------|--------|-------------|
| child `location.origin` | `"null"` (opaque) | isolation holds without any app-side CSP |
| child → `parent.document`, child → `localStorage` | `SecurityError` (both) | app DOM/credentials unreachable |
| child fetch / `<img>` of a **parent-created `blob:` URL** | **blocked** (`Failed to fetch` / error event) | object URLs are unusable inside the sandbox: assets MUST be inlined as `data:` URIs |
| `<iframe src="blob:…text/html">` as the document | loads, can `postMessage` the parent | blob-as-document works, but buys nothing over `srcdoc` and adds a URL lifecycle |
| `data:` subresources (`<img>`, `<script src>`, `<link rel=stylesheet>`) | all load | `data:` is the inlining vehicle for every asset kind |
| `srcdoc` child `document.baseURI` | **the parent document's URL** | an un-inlined relative ref resolves against the app origin, where the SPA history fallback answers `index.html` with `text/html` — a silently wrong 200, not a clean failure |
| injected `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; font-src data:">` | remote `<img>`, remote `<script>`, `fetch()` all blocked; `data:` + inline still work | a precise, in-document network lever, orthogonal to `sandbox` |
| same document with no injected meta CSP | CDN script, remote image, remote fetch all succeed | CDN-based documents (Plotly, Chart.js, Tailwind) work untouched |

## Public contract

### Viewer descriptor registry

`viewer-registry.ts` exposes one ordered descriptor table; every lookup structure is **derived** from
it at module load, so a new viewer is exactly one entry:

```
interface ViewerDescriptor {
  kind: ViewerKind;                       // "text" | "markdown" | "image" | "video" | "binary" | "html"
  component: ComponentType<ViewerProps>;  // lazy()
  extensions: readonly string[];          // lowercase, no dot
  mimePrefixes?: readonly string[];       // e.g. "image/"
  liveRefresh: boolean;                   // REQUIRED — no implicit default
}
export const VIEWER_REGISTRY: readonly ViewerDescriptor[];
```

Derived and re-exported for existing consumers, with unchanged names, shapes and semantics:
`VIEWER_BY_KIND`, `detectViewerKind(path, { mimeHint?, isBinary? })`, `isMoleculeFile(path)`, and the
live-refresh set consumed by `hooks/use-file-live-refresh.ts` (which stops maintaining its own copy).
`detectViewerKind` keeps extension-before-MIME precedence and its `isBinary` → `binary` /
otherwise-`text` fallthrough; `timeline/image-src.ts` continues to use it as its "is this an image?"
gate, so its outputs are frozen for every existing extension.

### Viewer props

```
interface ViewerProps {
  path: string;           // as stored on the tab — explorer-relative OR absolute; a viewer doing
                          // path math resolves it first: resolveWorkspacePath(path, workspaceCwd)
  workspaceCwd: string;   // the owning tab's workspace root ("~" expanded by the consumer)
}
```

`FilePanel` already holds both (`tab.workspaceCwd || "~"`); it passes both. `MarkdownFileViewer`
forwards `workspaceCwd` to `<Markdown assetBase=… workspaceCwd=… />`, which is what makes relative
images in a previewed markdown file resolve.

### Preview document assembly

`assembleHtmlPreview`, the sandbox tokens and the CSP constant live in `html-sandbox.ts`
(sprint-063); `extractLocalAssetRefs` and `confineAssetRef` live in `html-assets.ts` (sprint-064).

| Signature | Inputs | Outputs |
|-----------|--------|---------|
| `assembleHtmlPreview(source, { assets, blockRemote })` | raw document text; resolved asset substitutions; network policy | the `srcdoc` string |
| `extractLocalAssetRefs(source)` | raw document text | ordered, de-duplicated raw ref strings with their attribute context |
| `confineAssetRef(ref, docDir, root)` | one raw ref; document dir; confinement root | `{ kind: "local", path }` \| `{ kind: "skip", reason }` |
| `confinementRoot(docDir, workspaceRoot, homeDir)` | document dir; expanded workspace root; home dir | the effective root — the workspace root, narrowed to `docDir` when the workspace root is the home directory |
| `HTML_SANDBOX_TOKENS` | — | the frozen `sandbox` attribute token list |
| `HTML_PREVIEW_BLOCKING_CSP` | — | the meta-CSP string used when remote loading is blocked |

The iframe is rendered with `sandbox={HTML_SANDBOX_TOKENS.join(" ")}`, `referrerPolicy="no-referrer"`
and `allow=""` (no Permissions-Policy features). `HTML_SANDBOX_TOKENS` is `["allow-scripts"]`.

**Invariant — never `allow-same-origin`.** Paired with `allow-scripts` it re-grants the previewed
document the app's origin: app DOM, `localStorage` (daemon password), and the live socket. The token
list is a single frozen module constant with a test asserting `allow-same-origin`,
`allow-top-navigation*` and `allow-popups` never appear.

### Network policy

Remote loading is **allowed by default** — recorded product decision: the common case is an
agent-produced report that pulls a charting library from a CDN, and friction there is worse than the
residual risk, which the sandbox already bounds to "the document can talk to the network", never to
app state. A per-tab **"Block remote resources"** toggle (default off, component state, not
persisted) injects `HTML_PREVIEW_BLOCKING_CSP` as a `<meta http-equiv>` in the assembled document,
which blocks remote images, scripts, styles, fonts, media and `fetch`/XHR while leaving inline and
`data:` content working. Because sprint-064 inlines **every** asset kind as `data:`, the blocking
policy must carry `data:` in every directive an inlined asset can hit — `img-src`, `style-src` (a
stylesheet inlined as `<link href="data:text/css,…">` is not covered by `'unsafe-inline'`),
`script-src`, `font-src` and `media-src` — verified while implementing (see TODO(verify)).

### Base-URL neutralization

When the source document declares no `<base>` of its own, assembly injects
`<base href="https://pi-studio-preview.invalid/">`. Rationale: `srcdoc`'s base URL is the app's own
URL (measured above), so any ref that inlining did not rewrite would otherwise fetch the SPA's
`index.html` — a wrong 200 rather than a visible failure — and would put previewed-document traffic
on the app origin. `data:` substitutions and absolute remote URLs are unaffected by a `<base>` by
definition.

### Local asset inlining

Rewriting is **best-effort presentation, never a security boundary** — the sandbox is the boundary.
That is what makes a string-level pass (rather than a DOM parse, unavailable in this package's
node-environment test runner) an acceptable engineering choice: a missed ref degrades to exactly the
same outcome as no rewriting at all.

Attribute contexts scanned: `<link rel="stylesheet" href>`, `<script src>`, `<img src>`,
`<img srcset>`, `<source src>`, `<source srcset>`, `<video src>`, `<audio src>`, `<video poster>`,
plus `url(…)` inside an inlined stylesheet (one nested level).

Skipped without a fetch: anything carrying an explicit `scheme:`, protocol-relative `//…`,
fragment-only `#…`, `data:`, `mailto:`, and empty/whitespace refs.

Refs are matched **as authored**: HTML entities in attribute values (`a&amp;b.png`) are not decoded,
so such a ref simply fails to inline (best-effort, per above) — and no entity decoding may be added
inside the confinement path. The `font` asset context arises only from the stylesheet `url()` pass,
never from a scanned HTML attribute.

Confinement (**required**, and the reason inlining is not simply "fetch whatever the document
names"): a candidate is **percent-decoded first** (exactly once, non-throwing — `%2F` becomes a real
separator *before* any normalization, so an encoded traversal cannot survive the gate), then
resolved against the document's directory, lexically normalized with `lib/paths.ts`'s
`collapseDotSegments`, **rejected if any `.`/`..` segment remains**, and finally required to sit
under the confinement root by a segment-aware check — `path === root || path.startsWith(root + "/")`,
never a bare string prefix, which would accept a `/ws-evil` sibling of `/ws`. The decode-then-
normalize order is load-bearing: the reverse order lets `foo%2F..%2F..%2F..%2Fetc%2Fpasswd` pass as
a single opaque segment, decode back into a traversal, and read `/etc/passwd` via the daemon's own
`..` resolution. Anything failing the gate is skipped and never requested. Without this gate a
hostile document could name `../../../.ssh/id_rsa`, have the app fetch it, read it back out of its
own inlined `data:` URI, and — with remote loading on by default — post it anywhere.

The confinement root is the tab's workspace root (`~` expanded) — **except when that root is the
home directory itself** (a tab with no workspace falls back to `cwd = "~"`, `FilePanel.tsx`), in
which case the root narrows to the document's own directory. With all of `$HOME` as the root,
`~/.ssh/id_rsa` would be *inside* it and the gate vacuous exactly where it matters most; a
home-rooted tab therefore inlines same-directory and subdirectory assets only, which still covers
the actual shape of agent-produced reports.

Caps, enforced before any fetch: at most 64 assets, 2 MiB per asset, 16 MiB inlined in total. Over a
cap, or outside the workspace, or failed to fetch: the ref is left untouched and reported in a muted
"N references not inlined" note under the toolbar — never a silent blank render.

MIME for each `data:` URI is derived **client-side** from the asset's extension. The daemon's
`mimeHintForFile` has no `.html`/`.css`/`.js` entries and answers `application/octet-stream`, which
browsers reject for stylesheets and classic scripts; the client cannot rely on the hint anyway
(protocol compatibility: a newer client must work against an older daemon).

### Source loading (size tiers)

The HTML viewer reads its document through the same three-tier ladder `TextViewer` already
implements, extracted into a shared hook so all text-shaped viewers share one policy:

1. `size <= MAX_INLINE_FILE_READ_BYTES` (5 MiB, server-side) — `file_read_request`.
2. up to `MAX_DISPLAY_BYTES` (30 MiB) — the uncapped chunked binary download, decoded to text.
3. above that — terminal state: size, reason, manual download action.

Tier 2 matters here specifically: real coverage/benchmark HTML routinely exceeds 5 MiB.

### Toolbar & registration

`Preview | Source` toggle (Source is the existing `CodeView`, so highlighting/folding come free),
the "Block remote resources" toggle, and Reload. Default view is Preview, matching
`MarkdownFileViewer`. Extensions claimed: `html`, `htm`, `xhtml`. `svg` deliberately stays `image` —
an `<img>`-rendered SVG does not execute scripts, and routing it here would be a security regression
dressed as a feature. `liveRefresh: true`, so editing the file re-renders the preview within ~1s
through the existing watcher subscription.

## Behavior & algorithms

```
render(tab):
    abs    = resolveWorkspacePath(path, workspaceCwd)   # tab paths may be workspace-relative
    source = fileSource(abs)                   # 3-tier ladder; loading/error/too-large states
    if mode == "source": return CodeView(source)
    docDir = dirOf(abs)
    root   = confinementRoot(docDir, expandHome(workspaceCwd), homeDir)
             # = workspace root, narrowed to docDir when the workspace root IS the home dir
    refs = extractLocalAssetRefs(source)
    plan = []
    for ref in refs:
        r = confineAssetRef(ref, docDir, root)  # decode → resolve → collapse → reject ../ → root check
        if r.kind == "skip": record(ref, r.reason); continue
        if over_caps(plan, r): record(ref, "cap"); continue
        plan.push(r)
    if plan is empty: assets = {}              # nothing to inline — render immediately
    else: assets = await bundle(plan)          # single-load rule: never render an assetless
                                               # intermediate srcdoc and then swap it — that reloads
                                               # the document and runs its scripts twice
    for r in plan (bounded parallelism, inside bundle):
        bytes = binaryDownload(r.path)         # existing file-transfer path
        assets[r.ref] = dataUri(mimeForExtension(r.path), bytes)
        if isStylesheet(r): inline url(...) refs one level deeper, same rules
    doc = assembleHtmlPreview(source, { assets, blockRemote })   # memoized on its inputs
    return iframe(sandbox=HTML_SANDBOX_TOKENS, srcdoc=doc, referrerPolicy="no-referrer", allow="")

assembleHtmlPreview(source, opts):
    out = substitute(source, opts.assets)      # attribute-value replacement only
    if opts.blockRemote: inject <meta http-equiv=CSP> as the first <head> child
    if source declares no <base>: inject <base href="https://pi-studio-preview.invalid/">
    return out
```

Re-assembly is keyed on (source text, asset map, `blockRemote`); toggling the network policy
re-renders the iframe with a fresh `srcdoc` and therefore a fresh document — deliberate, since a
policy change cannot apply to an already-loaded document.

Assembly and the source hash are memoized on exactly those inputs: the `srcdoc` string identity must
be stable across unrelated re-renders (theme change, pane layout, Preview/Source toggle-and-back) —
React re-setting `srcDoc` reloads the document and re-runs its scripts, and re-hashing a 30 MiB
source per render is a main-thread stall.

## Data & persistence touchpoints

None. No new store field, no protocol field, no persisted state; the tab is a view of a path exactly
as `file`/`diff` tabs already are, and the network toggle is component state. `file` remains the tab
kind, so persisted pane layouts (`file:<path>` identity) keep working with no migration.

## Error handling & edge cases

| Condition | Expected behavior |
|-----------|-------------------|
| document read fails / file deleted while open | the viewer's existing error state (the watcher push triggers a refetch that fails) |
| document over 5 MiB | tier-2 streamed decode, no user-visible difference beyond a muted "streamed" note |
| document over 30 MiB | terminal state: size + reason + download action; no render attempt |
| asset outside the workspace root | skipped, never fetched, counted in the not-inlined note |
| asset over a cap | skipped, counted in the note |
| asset fetch fails | ref left as authored, counted in the note |
| document declares its own `<base>` | left untouched; no injection (the author's intent wins) |
| un-inlined relative ref | resolves against the injected `.invalid` base → clean failure, no request to the app origin |
| document scripts attempt app access | blocked by the sandbox (opaque origin) — measured |
| document with `target="_blank"` links / attempts top navigation | inert: neither `allow-popups` nor `allow-top-navigation` is granted; multi-page in-document browsing is out of scope |
| in-page anchor link (`<a href="#…">`) | scrolls within the preview. **Resolved (sprint-063/task-003, measured in headless Chromium):** with the injected `.invalid` base, clicking `<a href="#target">` resolves against `document.baseURI` (the `.invalid` host) while `location.href` stays `about:srcdoc` — the browser therefore treats it as cross-document navigation and replaces the entire preview with a network-error page. Fixed by injecting a small inline click-interceptor script alongside the base (`html-sandbox.ts`'s `FRAGMENT_ANCHOR_SCRIPT`) that `preventDefault()`s any `a[href^="#"]` click and scrolls manually (`scrollIntoView`/`scrollTo(0,0)` for an empty fragment) — verified against a live daemon: `scrollY` moves to the target, `location.href` stays `about:srcdoc`, no error page. Only injected alongside an injected base; never when the document declares its own. |
| tab has no workspace (`workspaceCwd` falls back to `~`) | confinement root narrows to the document's own directory; anything outside it is skipped and counted, never fetched |
| daemon lacks the binary download handler (`dev:daemon`) | asset fetches fail → the not-inlined note lists them; the document still renders |

## Dependencies on other specs

- [feature-panels-ui.md](feature-panels-ui.md) — the Files panel and viewer dispatch this extends.
- [file-explorer-transfer.md](file-explorer-transfer.md) — the binary download path assets ride.
- [file-link-rendering.md](file-link-rendering.md) — `[report](./report.html)` in chat already
  dispatches `openFileTab`, so agent-produced reports become one-click previews for free.
- [inline-image-rendering.md](inline-image-rendering.md) — `classifyImageSrc` consumes
  `detectViewerKind`; the registry refactor must not perturb it.
- `packages/web-client/AGENTS.md` (molecule dispatch: `isMoleculeFile`, the separate `molecule` tab
  kind) — the other dispatch path (tab kind, not viewer kind); no dedicated `swe/features/` spec
  exists for it (predates this doc; see sprint-044's task files). HTML deliberately does **not**
  copy it — see this spec's own "Adding a file viewer" reasoning in
  `packages/web-client/AGENTS.md` § Invariants.

## Acceptance criteria

- [ ] Adding a viewer is one `VIEWER_DESCRIPTOR` entry; `VIEWER_BY_KIND`, extension/MIME lookup and
      the live-refresh set are all derived, and `liveRefresh` is a required field (a new kind cannot
      silently inherit a default).
- [ ] `detectViewerKind` and `isMoleculeFile` return identical results to today for every extension,
      filename and MIME hint already covered by tests, plus `html`/`htm`/`xhtml` → `"html"`.
- [ ] No extension is claimed by two descriptors (enforced by test).
- [ ] A previewed markdown file's relative image (`![x](./shot.png)`) resolves and renders.
- [ ] Opening an `.html` file shows the rendered document; `Source` shows highlighted source.
- [ ] The previewed document cannot reach the app: `parent.document` and `localStorage` throw, and
      `HTML_SANDBOX_TOKENS` contains no `allow-same-origin`/`allow-top-navigation*`/`allow-popups`.
- [ ] A document with `./style.css`, `./app.js`, `./logo.png` renders styled, scripted and imaged.
- [ ] A document referencing a path outside the workspace root triggers no fetch for it and reports
      it as not inlined.
- [ ] A CDN `<script src="https://…">` executes by default; with "Block remote resources" on, it and
      every other remote load are blocked while inline/`data:` content still works.
- [ ] An HTML file over 5 MiB renders via the streamed tier; over 30 MiB shows the terminal state.
- [ ] Editing the open file on disk re-renders the preview within ~1s.
- [ ] A hostile ref using `%2F`-encoded separators (`..%2F..%2F..%2F.ssh%2Fid_rsa`) and a sibling
      directory sharing the root as a string prefix are both rejected without a fetch.
- [ ] A home-rooted tab (`workspaceCwd` = `~`) inlines only refs under the document's own directory.
- [ ] A source change loads the preview document exactly once — no assetless intermediate render.
- [ ] An in-page anchor link scrolls the preview instead of navigating the frame away.

## TODO(verify)

- **Resolved (sprint-063/task-003, measured in headless Chromium against the exact
  `HTML_PREVIEW_BLOCKING_CSP` string).** Every inlined-asset channel needs `data:` in its directive,
  confirmed for the three channels most at risk of a false "covered by `'unsafe-inline'`" assumption:
  a `data:`-sourced `<link rel="stylesheet">`, a `data:`-sourced classic `<script src>`, and a
  `data:`-sourced `<img>` all load and apply correctly under `HTML_PREVIEW_BLOCKING_CSP` as shipped
  (`style-src`/`script-src` both need the explicit `data:` token — `'unsafe-inline'` alone does
  **not** cover a `data:`-sourced element, only a literal inline `<style>`/`<script>` body — which
  is exactly the failure mode this policy was written to avoid). `font-src`/`media-src` were not
  independently measured but follow the identical `data:`-in-directive pattern and are exercised for
  real once sprint-064 starts inlining `@font-face`/`<video>`/`<audio>` assets.
- **Resolved (sprint-063/task-003, measured in headless Chromium against a live daemon).** With the
  injected `.invalid` base, `<a href="#target">` did attempt a frame navigation and replace the
  preview with a network-error page — see the edge-case table's "in-page anchor link" row for the
  root cause and the fix (`html-sandbox.ts`'s `FRAGMENT_ANCHOR_SCRIPT`, injected alongside the base).
- Non-Chromium parity (Firefox/Safari) for `data:` script subresources inside a sandboxed frame is
  unverified; the app ships Chromium-first (Electron shell) but a Firefox check is cheap.
- Whether the not-inlined note should list refs individually or only count them is a UI judgement
  left to the implementing task.
