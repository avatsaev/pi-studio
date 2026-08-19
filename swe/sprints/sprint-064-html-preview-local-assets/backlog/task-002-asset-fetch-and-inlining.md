# Task 002 — Asset fetch orchestration + `data:` inlining in `HtmlViewer`

- **Sprint:** sprint-064-html-preview-local-assets
- **Status:** backlog
- **Type:** feature
- **Area:** web-client / features/files
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** task-001

## Goal
Wire the pure asset core into the viewer: fetch the confined refs over the existing binary
file-transfer path, inline them as `data:` URIs, recurse one level into inlined stylesheets, and
surface everything that was skipped. The document already renders (sprint-063); this task is exactly
the difference between "renders unstyled" and "renders as authored".

## Context / why
Assets must arrive over the daemon's chunked binary download (`file_download_token_request` →
`file_download_request` → `Begin`/`Chunk`/`End` frames) because that is the only uncapped file
transport, and it works over the E2EE relay. They must land as `data:` URIs, not object URLs: a
sandboxed opaque-origin document cannot fetch a parent-created `blob:` URL (measured).

`useFileDownload` is the wrong shape for this — it is a per-path hook with revoke-on-unmount object
URL ownership, and this task needs *N* bytes fetches keyed on a document. The transport underneath it
(`transferFor(daemon).download(path)`, `hooks/file-transfer-instance.ts`) is the right seam, exactly
as `use-inline-image.ts` reached past the hook for the timeline's own cache.

## Scope references
- `swe/features/html-file-preview.md` § Local asset inlining, § Error handling & edge cases
- `packages/web-client/src/features/files/html-assets.ts` (task-001)
- `packages/web-client/src/features/files/html-sandbox.ts`, `HtmlViewer.tsx` (sprint-063)
- `packages/web-client/src/hooks/file-transfer-instance.ts`, `use-file-download.ts` (transport seam
  and the ownership policy *not* to reuse)
- `packages/web-client/src/hooks/use-inline-image.ts` (precedent for a framework-free fetch core)
- `packages/web-client/src/lib/connection/rpc-keys.ts` (a key for the per-document asset bundle)

## What to build
- A framework-free async core (e.g. `html-asset-loader.ts`) taking the confined ref list plus a
  byte-fetch function and returning `{ assets: Record<raw, dataUri>, skipped: SkippedRef[] }`:
  bounded parallelism (e.g. 6 in flight), per-asset and total byte caps enforced as bytes arrive,
  one fetch per de-duplicated path, and a second pass that runs `rewriteCssUrls` over each inlined
  stylesheet (one nested level) fetching its `url()` targets under the same rules. A fetch failure
  degrades that ref to `skipped`, never the whole preview. Injected fetch function → unit-testable
  with a fake, no network and no DOM.
- `HtmlViewer`: a TanStack Query keyed on `(path, source hash)` driving that core, so the asset
  bundle refetches when the document changes (live refresh) and not otherwise; the source hash is
  memoized (never re-hash a 30 MiB string on unrelated re-renders); the resolved map is handed to
  `assembleHtmlPreview`. Confinement inputs: resolve the tab path via `resolveWorkspacePath(path,
  workspaceCwd)` before `dirOf`, and compute the effective root with `confinementRoot(docDir,
  expandedWorkspaceRoot, homeDir)` (home dir from `useHomeDir`) — a home-rooted tab confines to the
  document's own directory.
- **Single-load rule:** when extraction finds zero confined local refs, render immediately;
  otherwise hold the preview's loading state until the asset bundle settles — an intermediate
  assetless `srcdoc` swapped for the inlined one reloads the document and runs its scripts twice
  (beacons fire twice, charts init twice). The bundle itself never blocks on one asset: a failed,
  over-cap or skipped ref settles as `skipped` and the preview renders with the rest.
- Skipped refs surface as a muted single-line note under the toolbar (count, with the reasons
  aggregated: outside workspace / over cap / not found), expandable to the list. This is the visible
  contract for "the preview is not lying to you".
- `mimeForAssetPath` is the only MIME source for `data:` URIs; the daemon's `mimeHint` is ignored.

## Out of scope
- Watching each inlined asset for changes: only the document is watched (sprint-063's
  `liveRefresh: true`). An edited stylesheet updates on the toolbar's Reload — documented, not fixed
  here (per-asset watches would need N ref-counted subscriptions for a preview).
- `@import` chains beyond one nested level; refs inside the document's own inline `<style>` blocks.
- Any daemon change (including adding `.html`/`.css`/`.js` to `mimeHintForFile`).

## Acceptance criteria
- [ ] A fixture `report.html` with `./style.css`, `./app.js`, `./img/logo.png` and a `url()`
      background inside the stylesheet renders fully styled, scripted and imaged.
- [ ] Every asset arrives as a `data:` URI in the assembled document — no `blob:` anywhere in the
      preview.
- [ ] A ref outside the workspace root triggers **no** download RPC (verified against daemon logs or
      a request-count assertion in the loader's unit test) and appears in the skipped note.
- [ ] Over-cap and failed-fetch refs appear in the skipped note; the rest of the document still
      renders.
- [ ] The asset bundle refetches when the document changes on disk, and does not refetch on a
      Preview/Source or network-policy toggle.
- [ ] A source change loads the preview document exactly once — no assetless intermediate render
      precedes the inlined one (verified with a script side-effect counter in the fixture).
- [ ] A home-rooted tab (`workspaceCwd` = `~`) inlines only refs under the document's own
      directory; anything else is skipped without a fetch.
- [ ] With "Block remote resources" on, the inlined `data:` assets — stylesheets, scripts, images,
      fonts and media — all still load (resolves the spec's blocking-CSP `TODO(verify)`; adjust
      `HTML_PREVIEW_BLOCKING_CSP`'s per-directive `data:` allowances as the measurement dictates,
      and record the measurement).
- [ ] Loader unit tests pass in the node environment with an injected fake fetch; no jsdom.
- [ ] `npm run build:web-client` and `npm run typecheck` pass.

## Test / verification plan
- Unit: `npx vitest run packages/web-client/src/features/files` — loader behavior (parallelism bound,
  caps, dedupe, nested CSS pass, failure isolation, zero fetches for skipped refs).
- Manual (production daemon, real browser): the fixture above; then edit `style.css` and confirm
  Reload picks it up while the document-only watch behaves as documented; then a deliberately hostile
  fixture referencing `../../../.ssh/id_rsa` and confirm no fetch and a skipped entry.
- Build/typecheck as above.

## Notes
Base64 inflates ~33%: the byte caps in `ASSET_LIMITS` are on raw bytes, and the total cap exists to
keep the assembled `srcdoc` string from becoming a multi-hundred-MB main-thread allocation. If the
assembled document exceeds the total cap despite per-asset checks, stop inlining and report the
remainder as skipped rather than assembling it.
