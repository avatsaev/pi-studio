# Task 007 — Sprint close: live E2E matrix + docs sync — Summary

- **Sprint:** sprint-073-viewer-settings
- **Completed:** 2026-10-05
- **Status:** done

## What was done

1. **Seven-step live E2E** run end to end against a **production-bootstrap daemon** and real
   Chromium, two browser windows on the same agent-free workspace. Every step's observed result
   is recorded below.
2. **Docs sync** (this close commit): root `AGENTS.md` (new `viewer_settings_*` protocol-overview
   bullet + `viewer-settings.json` persistence-layout entry), `docs/MOLVIEWER_DECOUPLING.md`
   (status header + § 5 Phase 0 + § 10 chunk A marked shipped; § 11 review-log close entry with
   the ten verified implementation deviations and the E2E outcomes),
   `swe/architecture/viewer-plugin-system.md` (phase-0 prerequisite marked shipped; `TODO(verify)`
   on the enabled-filter selector resolved to `isViewerEnabled`), and `swe/sprints/PLAN.md`
   (sprint-073 → complete).
3. **Full root gates** re-run after the doc edits (see bottom).

## E2E harness

- Daemon: `PI_STUDIO_HOME=/tmp/pi-studio-e2e-s073/home PI_STUDIO_LISTEN=127.0.0.1:6799
  PI_STUDIO_HOSTNAMES=true node packages/server/dist/daemon/main.js` — production `main.ts`,
  because persistence exists only there (the dev bootstrap is in-memory). `PI_STUDIO_HOSTNAMES=true`
  because the default Host allow-list rejects `127.0.0.1`.
- UI: `node packages/cli/dist/cli.js ui --ui-port 4173 --daemon-host 127.0.0.1:6799` (built CLI,
  production static-asset path). Both windows at
  `http://127.0.0.1:4173/?host=ws%3A%2F%2F127.0.0.1%3A6799&connect=1`.
- Fixtures: `silicon.cif` (viewer steps) and `silicon2.cif` (text step) in
  `/tmp/pi-studio-e2e-s073/data`, so steps don't collide. The real `~/.pi-studio` was never touched.

## Step-by-step observed results

**Step 1 — production bootstrap, viewer renders.** `v0.0.106 … connected` in the status bar;
workspace `/tmp/pi-studio-e2e-s073/data` opened via the dialog; clicking `silicon.cif` opened a
tab containing a `<canvas>` (MolViewer). **PASS.**

**Step 2 — Settings → Viewers flip persists to disk.** Gear → Viewers → "Molecule Viewer"
`role="switch"` flipped `aria-checked` true→false through the UI.
`/tmp/pi-studio-e2e-s073/home/viewer-settings.json` became exactly
`{"version":1,"viewers":{"molviewer":{"enabled":false}}}` (mode 0644, one row); `ls` of the home
showed no `.tmp` residue (atomic write cleaned up after itself). **PASS.**

**Step 3 — dispatch points gated off.** `silicon2.cif` click opened a **TEXT** tab (body shows
`_cell_length_a` + line numbers). File context menu = `Open | Copy Absolute Path | Copy Relative
Path | Download | Rename | Delete` — no "Open in MolViewer", no "Open as Text". The `+` tab menu
(`button[title="New tab"]`, which opens only on a trusted `page.mouse.click`) = `New chat |
New terminal` only — no "New molecule view". **PASS.**

**Step 4 — second window converges without reload.** win2 (same URL) opened its Viewers panel
with the switch already `false`; flipping it `true` in win2 changed win1's **open-dialog** switch
to `true` with no reload — a `window.__e2eReloadMarker` set in win1 survived, proving no
navigation. **PASS over the direct WebSocket transport.**
**Relay variant: NOT RUN** — the task spec explicitly excludes standing up a relay ("do not block
the sprint on standing one up"). The relay transport carries the same broadcast bytes
E2E-encrypted, and task-002's daemon-side broadcast ordering is transport-independent.

**Step 5 — state survives reload and daemon restart.** Reload of win1 → switch `true`. Killed
and restarted the daemon on the same home → UI auto-reconnected → switch `true`. **PASS.**

**Step 6 — open viewer untouched on disable; replay degrades to text.** With the viewer on,
`silicon.cif` rendered (`canvas` + "Ball & stick" controls). Disabled via Settings →
`viewerStillRenderingAfterDisable: true` — the open tab was not torn down (invariant: the kill
switch gates entry points, not live renderers). Reload → tab strip lists `silicon.cif` +
`silicon2.cif`; the active panel is a text editor at `/tmp/pi-studio-e2e-s073/data/silicon.cif`
(line numbers, CIF text, File/Diff toggle), no viewer controls — the persisted viewer tab was
**replayed as a TEXT tab**. **PASS.**

**Step 7 — corrupt state file degrades soft.** Valid file `sha256sum` =
`970048736e54ae3eb96b4b0d89aad7f910aaaf1fcc4fb69bf7f6c5280540f90c`; overwrote it with
`this is {{{ not json at all\n`; restarted the daemon; reconnected UI → switch `true`
(everything enabled). Daemon log (`/tmp/pi-studio-e2e-s073/home/logs/*.log`) carries pino
`level:40, component:"viewer-settings", msg:"viewer-settings.json is corrupt JSON; degrading to
all-enabled defaults"` — 3 entries, confirming the warn fires **lazily per `get`**, not at boot;
the file was byte-identical afterward (`e5069070fdeb7502be0b53731b34b16edb4c280f2bb1d23628b5f48897767fc9`)
— never rewritten on read. Soft-fallback confirmed, deliberately **not** `extensions-state.ts`'s
`"unreadable"` sentinel. **PASS.**

## Docs-sync notes

- The root `AGENTS.md` bullet records why `viewer_settings_update` is a real
  `sessionMessageSchema` member rather than a passthrough push (same durable document, parsed on
  the hot tab-layout replay path) — unlike `provider_auth_flow_event`.
- The § 11 close entry lists the ten verified deviations from the spec (hand-rolled soft-fallback
  loader; `isViewerSettingsPatch` guard answering unchanged-document on invalid patch; store
  `capable` field with catch-keeps-capable semantics; `notifyRollback()` toast;
  `settings-categories.ts` split for code-split; `capable:false` disabled-switch shape; pure
  `shouldReplayPaneLayout` gate + 5 gated dispatch points; module-local `enqueueSet` promise
  queue; broadcast-before-answer; gear gate fixed to category availability).
- The phase-1 spec's `TODO(verify)` is resolved: the shipped selector is `isViewerEnabled(id)`,
  both a `useViewerSettingsStore` state method and a module-level export of
  `viewer-settings-store.ts` for non-React callers.

## Test / verification performed

- `npm run build` — green (build precedes the E2E harness; unchanged by Markdown-only close).
- `npm run typecheck` (`tsc -b`) — clean.
- `npm test` — 208 files, **2751 tests, all passing**.
- `npm run lint` — exit 0; 66 pre-existing warnings in untouched files, zero errors.
- `npx oxfmt --check` on the touched files — all Markdown, all excluded by ignore rules
  (`.oxfmtrc.json`); no formatting jurisdiction over this change.

## Files changed (close commit)

`AGENTS.md`, `docs/MOLVIEWER_DECOUPLING.md`, `swe/architecture/viewer-plugin-system.md`,
`swe/sprints/PLAN.md`, this file, and the `backlog/ → done/` move of
`task-007-sprint-close.md`.
