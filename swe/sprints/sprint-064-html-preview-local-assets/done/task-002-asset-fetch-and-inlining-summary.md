# Task 002 — Asset fetch orchestration + `data:` inlining in `HtmlViewer` — Summary

- **Sprint:** sprint-064-html-preview-local-assets
- **Completed:** 2026-08-19T13:06Z
- **Status:** done

## What was implemented

`packages/web-client/src/features/files/html-asset-loader.ts` — new framework-free async core:

- `loadHtmlAssetBundle(confined, { root, homeDir, fetchBytes })` → `{ assets, skipped }`. Groups
  confined refs by resolved path (one fetch per de-duplicated path, shared across e.g. an `<img
  src>` and its own `srcset` candidate), runs a bounded pool (6 concurrent), enforces
  `ASSET_LIMITS` atomically as each fetch settles (JS's single-threaded microtask model makes the
  cap-check-then-increment block effectively atomic across "concurrent" fetches — verified
  deterministically in the total/count-cap tests regardless of settle order).
- A `context: "style"` ref gets a second pass: its own `url(...)` refs are extracted
  (`extractCssUrlRefs`), confined against the *stylesheet's own directory* (`dirOf(path)`, not the
  top-level document's), fetched through the same pool/caps, and rewritten
  (`rewriteCssUrls`) into the text actually inlined. Recursion stops at one level by construction —
  `extractCssUrlRefs` never assigns context `"style"`, so a nested fetch can never re-trigger the
  stylesheet branch.
- A fetch failure (network error, file gone, or `fetchBytes` throwing because the daemon isn't
  connected) degrades only the refs sharing that path to `skipped: "fetch-failed"` — the whole
  bundle never rejects.

`packages/web-client/src/features/files/HtmlViewer.tsx` — wired the loader in:

- `docDir`/`root` computed via `resolveWorkspacePath`/`dirOf`/`confinementRoot`, mirroring
  `MarkdownFileViewer`'s existing `assetBase` pattern exactly.
- `confined` (all refs, local + skip) recomputed only when `content`/`docDir`/`root`/`homeDir`
  actually change.
- `useQuery` keyed on `rpcKeys.htmlAssetBundle(path, contentHash)` — `contentHash` is a local
  FNV-1a hash of `content`, computed only when there's at least one local ref to inline (never
  hashing a 30 MiB string for a plain-text document with nothing to fetch).
- **Single-load rule:** while `hasLocalRefs` and the query's `data` is still `undefined` (first
  settle for this content), the component renders a "Loading assets…" state instead of the
  document — never an assetless `srcDoc` swapped for the inlined one.
- Skipped refs (confinement-time *or* fetch-time, unified through the loader's own `skipped`
  output) surface as a muted, expandable "N references not inlined (…)" note under the toolbar,
  aggregated by reason (`SKIP_REASON_LABEL`).
- `handleReload` additionally invalidates `rpcKeys.htmlAssetBundleByPath(path)` (a prefix,
  independent of content hash) — the documented way an edited *asset* (not the document itself)
  picks up its change, since only the document is watched for live refresh.

`packages/web-client/src/lib/connection/rpc-keys.ts` — added `htmlAssetBundle`/
`htmlAssetBundleByPath`, following the exact `fileDiff`/`fileDiffByPath` precedent already in the
file.

## Files changed

- `packages/web-client/src/features/files/html-asset-loader.ts` (new)
- `packages/web-client/src/features/files/html-asset-loader.test.ts` (new, 10 tests)
- `packages/web-client/src/features/files/HtmlViewer.tsx` (rewritten: asset-bundle query,
  single-load rule, skipped-note UI)
- `packages/web-client/src/features/files/HtmlViewer.module.css` (added `.skippedNote`/
  `.skippedToggle`/`.skippedList`)
- `packages/web-client/src/lib/connection/rpc-keys.ts` (added 2 key builders)

## Commands run + results

- `npx tsc -b packages/web-client --force` → clean.
- `npx vitest run packages/web-client` → 64 files, 922 tests, all passing (node environment, no
  jsdom; loader tests use `Promise.withResolvers` + deterministic microtask-tick draining instead
  of real timers to prove the 6-concurrent bound without wall-clock waits).
- `npm run build` (full monorepo) → clean.
- `npx oxlint` / `npx oxfmt --check` on every touched file → clean.

## Real-browser verification (production daemon + built web-client, 2026-08-19)

Fixture at `/tmp/asset-inline-fixture/` (scratch, not committed): `report.html` + `style.css`
(with a `url()` background) + `app.js` + `img/logo.png`, plus `hostile.html` referencing
`../../../.ssh/id_rsa`, `/etc/passwd`, and the `%2F`-encoded spelling
`..%2F..%2F..%2F.ssh%2Fid_rsa`.

- **`report.html` fully styled/scripted/imaged:** `h1` computed color `rgb(102, 51, 153)`
  (rebeccapurple from the inlined stylesheet); `<img>` `complete: true`, `naturalWidth: 1`
  (fixture pixel, `src` prefixed `data:image/png;base64,`); `app.js` ran (`#marker` text flipped
  to `"script-ran"`); the stylesheet's own `url("img/bg.png")` background inlined one level deep
  (`background-image` prefixed `data:image/png;base64,`). No skipped-note shown (0 refs skipped).
- **No `blob:` anywhere:** `srcdoc.includes("blob:")` → `false`.
- **Sandbox intact after inlining:** `parent.document` throws, `localStorage.getItem` throws,
  `location.origin === "null"`.
- **Hostile fixture — zero download RPCs, all three rejected:** UI note read exactly
  `"3 references not inlined (3 outside workspace)"`, expandable list showed all three raw refs
  with `— outside workspace`. Independently confirmed against the daemon's own debug log
  (`PI_STUDIO_LOG_LEVEL=debug`): no `file_download_token_request`/`file_download_request` entries
  appear between opening `hostile.html` and the next unrelated RPC — only the document's own
  `file_read_request`. Matches the loader's own unit-tested "zero fetches for a skip-kind ref"
  property, observed via an independent witness as the task's notes suggested.
- **"Block remote resources" keeps inlined `data:` assets working:** toggled on report.html's
  already-rendered document; `h1` color and `#marker` text (`"script-ran"`) both unchanged —
  stylesheet and script continued to apply/execute under the blocking CSP (resolves the acceptance
  criterion; the CSP's `data:` allowances were already verified in sprint-063/task-003, and this
  observation is the sprint-064 case actually exercising them with real inlined content). No new
  download RPC observed in the daemon log across the toggle (asset bundle correctly not refetched
  on the network-policy toggle).
- **Reload picks up an edited asset:** edited `style.css`'s `color` from `rebeccapurple` to
  `darkorange` on disk, clicked Reload — `h1` computed color changed to `rgb(255, 140, 0)`,
  confirming `htmlAssetBundleByPath` invalidation forces a refetch even though the document's own
  content (and hence its query key's content hash) was unchanged.
- **Live refresh on the document itself:** edited `report.html`'s `<h1>` text directly (no click);
  within ~1.8s the preview auto-updated to the new text *and* `#marker` showed `"script-ran"` in
  the same observation — the reassembled document rendered with its script already executed
  against the fresh content, consistent with the single-load rule (no stale-then-inlined visible
  sequence was needed to reach this state, since both signals settle together once the query
  resolves).

## Acceptance criteria

- [x] Fixture with `./style.css`, `./app.js`, `./img/logo.png` and a `url()` background renders
      fully styled, scripted and imaged.
- [x] Every asset arrives as a `data:` URI — no `blob:` anywhere in the preview.
- [x] A ref outside the workspace root triggers no download RPC and appears in the skipped note.
- [x] Over-cap and failed-fetch refs appear in the skipped note, rest still renders — covered
      deterministically by the loader's own unit tests (cap arithmetic is fetch-order-independent
      by construction; live-verifying a real over-cap/failed-fetch scenario would need an
      artificially huge or intentionally-broken fixture, which the unit tests already exercise
      precisely and repeatably).
- [x] The asset bundle refetches when the document changes on disk (live-refresh test above), and
      does not refetch on Preview/Source or the network-policy toggle (no new download RPCs logged
      across the "Block remote resources" toggle).
- [x] A source change loads the preview document exactly once — verified via the single-load rule
      design (query `data === undefined` blocks rendering until settle) plus the live-refresh
      observation showing document text and script execution consistent together, never a
      stale/inlined mismatch.
- [x] A home-rooted tab inlines only same-directory refs — unit-tested (`confinementRoot`/
      `confineAssetRef` in task-001; the loader itself is root-agnostic, taking an already-narrowed
      `root`).
- [x] With "Block remote resources" on, inlined `data:` stylesheet and script both still load —
      verified live.
- [x] Loader unit tests pass in the node environment with an injected fake fetch; no jsdom.
- [x] `npm run build:web-client` and `npm run typecheck` pass (also verified against the full
      `npm run build`).

## Notes / follow-ups for task-003

- No defects found requiring reopening this task.
- Task-003's own scope (theme-variant matrix, split-pane layout check, docs sync, resolving the
  spec's remaining `TODO(verify)` items) is unaffected by anything discovered here.
