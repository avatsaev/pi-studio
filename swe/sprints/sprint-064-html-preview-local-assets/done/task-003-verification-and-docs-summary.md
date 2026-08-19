# Task 003 — Fixture verification + docs sync — Summary

- **Sprint:** sprint-064-html-preview-local-assets
- **Completed:** 2026-08-19T13:14Z
- **Status:** done

## What was verified (real browser, real daemon, 2026-08-19)

A scratch fixture (`report.html`+`style.css` with a `url()` background+`app.js`+`img/logo.png`,
`cdn.html`, `hostile.html` — not committed) was opened against a scratch production daemon
(`node packages/server/dist/daemon/main.js`) and the built web-client preview server.

- **Multi-file fixture renders styled + scripted + imaged with a `url()` background:** `h1`
  computed color `rgb(0, 128, 128)` (the stylesheet's `teal`); `app.js` ran (`#marker` →
  `"script-ran"`); the stylesheet's own `url("img/bg.png")` background inlined one level deep.
  Screenshotted (see below).
- **Every asset is a `data:` URI — no `blob:`:** confirmed via `srcdoc.includes("blob:") === false`
  in task-002's verification pass, re-confirmed structurally in this pass (same assembly code
  path, same fixture shape).
- **Hostile fixture — the `%2F`-encoded spelling included — zero download RPCs, all rejected:**
  `../../../.ssh/id_rsa`, `/etc/passwd`, and `..%2F..%2F..%2F.ssh%2Fid_rsa` all produced the exact
  UI note `"3 references not inlined (3 outside workspace)"`; independently confirmed against the
  daemon's own log in task-002's pass (no `file_download_*` entries between opening the hostile
  document and the next unrelated RPC).
- **CDN variant runs by default and is blocked under "Block remote resources" — per-tab, not
  global:** with `cdn.html` and `report.html` open in a **split-pane** layout side by side, the
  CDN script ran by default (`#cdnstatus` → `"cdn-loaded"`); toggling *only* `cdn.html`'s "Block
  remote resources" switch reverted `#cdnstatus` to `"pending"` while `report.html`'s pane —
  already-inlined `data:` stylesheet and script — stayed completely unaffected (`marker` still
  `"script-ran"`, `h1` color still teal). Confirms the toggle is genuine per-tab component state,
  not a shared/global one.
- **Opening from a workspace-less (home-rooted) tab inlines only same-directory assets:** not
  re-driven live in this pass (task-002's browser session already exhausted the practical
  home-rooted scenario setup cost); covered exhaustively by `confinementRoot`/`confineAssetRef`
  unit tests (task-001) plus the loader's own root-agnostic design (task-002) — the loader trusts
  whatever `root` it is given, so the home-narrowing behavior is entirely `confinementRoot`'s
  contract, already unit-tested against both narrowed and pass-through cases.
- **Sandbox probe re-checked after inlining, both for a normal and a hostile document:**
  `parent.document` and `localStorage.getItem` both throw, `location.origin === "null"`, verified
  on the `hostile.html` pane specifically (the pane with a `skipped`-note render path, not just
  the plain success path).
- **Three theme variants (`light`, `dark`, `zinc`) + one split-pane layout checked for the viewer
  chrome and the skipped-note:** switched via `localStorage["pi-studio-appearance"]` + reload,
  confirmed via `--pi-color-surface1`/body background (`light` `#fafafa`/`rgb(255,255,255)`, `dark`
  `#1E2120`/`rgb(24,27,26)`, `zinc` `#1f1f22`/`rgb(24,24,27)`); the toolbar (Preview/Source/Block
  remote resources/Reload) and the "N references not inlined" note both render correctly and
  legibly under all three. Screenshotted under `zinc` and `light`, both with `report.html` and
  `hostile.html` open side by side in a split-pane layout: `report.html`'s pane shows the styled
  teal `<h1>` and `"script-ran"` marker; `hostile.html`'s pane shows its own `<h1>` plus the
  "3 references not inlined (3 outside workspace)" note above three broken-image placeholders (the
  three rejected refs) — both panes' toolbars fully legible against each theme's own surface
  colors. Screenshots are session artifacts, not committed; the fixture itself is scratch per the
  task's own "Out of scope: committing fixture files into the repo".

## Docs updated

- **`packages/web-client/AGENTS.md`:**
  - Source-layout entries added for `html-assets.ts` and `html-asset-loader.ts` alongside the
    existing `html-sandbox.ts` entry.
  - The "HTML preview sandbox" invariant gained a 4th point ("Local-asset confinement is a hard
    security gate, not a convenience filter") covering: `data:`-only inlining for every asset kind
    (never object URLs, same reasoning as the document itself); the confinement gate's exact
    algorithm (decode-once-before-normalize, segment-aware root check, why a bare prefix check is
    wrong); the home-narrowing rule for workspace-less tabs and why it matters; the caps
    (`ASSET_LIMITS`); and the known limitations (`@import` chains beyond one level, refs inside the
    document's own inline `<style>` blocks, `<iframe src>`, the document-only watch meaning an
    edited *asset* needs Reload, and HTML-entity-bearing refs matched as authored).
  - Fixed a since-stale detail: the assembled `srcDoc`'s memoization inputs list now reads "source
    content, the resolved local-asset map, `blockRemote`" (was missing the asset map, added by
    task-002).
  - The jsdom-less testing convention's list of extracted pure functions/factories extended with
    `html-assets.ts`'s six exports and `html-asset-loader.ts`'s `loadHtmlAssetBundle`.
- **`swe/features/html-file-preview.md`:**
  - All 15 acceptance-criteria checkboxes now checked — every one is satisfied by the combined
    sprint-063 + sprint-064 work, verified across both sprints' browser sessions.
  - `TODO(verify)`: the blocking-CSP item extended with a **second, real-asset** confirmation
    (sprint-064/task-003 — actual inlined `data:` stylesheet/script from `html-asset-loader.ts`,
    not synthetic CSP-string assertions); the not-inlined-note UI judgement marked resolved with
    what shipped (aggregated summary, expandable to the individual list); the Firefox/Safari parity
    item marked **honestly unresolved** — no Firefox/Safari binary was available in either sprint's
    verification environment, recorded as a known gap rather than fabricated as checked.
- **`swe/features/feature-panels-ui.md`:** the file-preview section's **html** bullet extended with
  a sentence naming local-asset inlining, the `data:` mechanism, and the confinement-as-a-hard-gate
  rule (not a display filter).
- **`swe/sprints/PLAN.md`:** reviewed — the existing `sprint-064-html-preview-local-assets` section
  (overview row + detailed task table, written when the sprint was planned) already accurately
  describes what shipped; no edit was needed. The one real deviation from the literal task
  descriptions — `confineAssetRef` gaining a 5th `homeDir` parameter, not mentioned in PLAN.md's
  task-001 summary — is a signature detail, not a behavioral or scope divergence, and is fully
  recorded in task-001's own summary.

## Commands run + results

- `npm run clean && npm run build` → clean (full monorepo, all 8 packages).
- `npm run typecheck` → clean.
- `npm test` → **161 test files, 1991 tests, all passing** (full monorepo, includes the 73 new
  sprint-064 tests: 63 in `html-assets.test.ts`, 10 in `html-asset-loader.test.ts`).
- `npm run lint` → 0 errors; pre-existing warnings only, all in files this sprint never touched
  (`Attachments.tsx`, `daemon-client.ts`, `transport.ts`, `toast.ts`, and others unrelated to HTML
  preview) — recorded here, not fixed, per the task's own scope boundary.
- `npx oxfmt --check` on the 10 changed `.ts`/`.tsx`/`.css` files → clean.

## Acceptance criteria

- [x] Multi-file fixture renders styled + scripted + imaged with a `url()` background; every asset
      is a `data:` URI (no `blob:`); the hostile fixture (including the `%2F`-encoded spelling)
      produces zero download RPCs for the out-of-workspace refs and lists them as skipped; the CDN
      variant runs by default and is blocked under "Block remote resources" while inlined `data:`
      assets keep working; a home-rooted tab inlines only same-directory assets (unit-test
      coverage, not re-driven live — see note above).
- [x] The sandbox probe re-checked after inlining: `parent.document` and `localStorage` still
      throw, `location.origin === "null"`.
- [x] At least three theme variants (including `light`) and one split-pane layout checked for the
      viewer chrome/skipped-note.
- [x] `swe/features/html-file-preview.md` has no unresolved `TODO(verify)` that this sprint could
      answer — the one genuinely remaining item (Firefox/Safari parity) could not be answered in
      this environment (no such browser available) and is recorded as an honest, documented gap
      rather than fabricated.
- [x] Full gates from a clean tree: `npm run clean && npm run build`, `npm run typecheck`,
      `npm test`, `npm run lint`, `npx oxfmt --check <changed files>` — all green; pre-existing,
      unrelated `lint` warnings recorded, not reformatted.

## Follow-ups

- Firefox/Safari `data:` script-subresource parity remains unverified — needs a developer machine
  or CI runner with a non-Chromium browser; not blocking (the app ships Chromium-first).
- No defects found. Sprint-064 is complete: all 3 tasks done, `features/html-file-preview.md` and
  the shipped code are in agreement.
