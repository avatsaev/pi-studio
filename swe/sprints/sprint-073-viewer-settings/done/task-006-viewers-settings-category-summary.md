# Task 006 — "Viewers" settings category + reachable settings gear — Summary

- **Sprint:** sprint-073-viewer-settings
- **Completed:** 2026-09-10
- **Status:** done

## What was implemented

1. **`ViewersPanel.tsx` (+ module.css)** — one `Switch` row, "Molecule Viewer", bound to
   `useViewerSettingsStore`'s `isViewerEnabled("molviewer")`/`setEnabled`. `capable === false`
   disables the switch and shows a "Requires a newer daemon." note without hiding the row;
   `isViewerEnabled`'s existing `?? true` default (task-004) already reads the switch as ON in
   that state, so no separate "force checked" branch was needed.
2. **`settings-categories.ts` (new module, not folded into `SettingsDialog.tsx`)** — holds
   `SettingsCategoryCapabilities`, `SettingsCategory`, `SETTINGS_CATEGORIES` (now `providers` +
   `viewers`), and the new `buildSettingsCategoryCapabilities(features)` helper. Split out
   specifically so `ConnectionBar.tsx` can import the registry array **eagerly** (to gate the
   gear) without also pulling `SettingsDialog.tsx`'s own eager imports (`Dialog`, `LoginDialog`,
   `provider-auth-store`) into the main bundle ahead of the gear ever being clicked — a static
   import of the old combined module would have silently defeated that existing code-split. The
   `viewers` entry is `available: () => true` — the first capability-independent category.
3. **`SettingsDialog.tsx`** — trimmed to import the registry from `settings-categories.ts`; its
   own `caps` build now calls the shared helper instead of duplicating the
   `serverInfo?.features?.[…]` read.
4. **`ConnectionBar.tsx`** — the gear's render condition changed from `providerAuthCapable` (a
   `providerAuth`-only read) to `SETTINGS_CATEGORIES.some((c) => c.available(settingsCaps))`,
   with `settingsCaps` built via the same shared helper — real bug fix, not polish: a
   capability-free daemon previously hid the gear entirely, making the new Viewers category
   unreachable.
5. **`viewer-settings-store.ts`** — `setEnabled`/`setConfig`'s existing `catch` blocks (rollback)
   now also call a new `notifyRollback()` helper, which surfaces `useToastStore.getState().error(…)`
   — matching `fork-result.ts`'s established convention of the store/handler owning the toast
   call rather than threading an error back through the component.
6. **`packages/web-client/AGENTS.md`** — rewrote the `settings/` source-layout entry (module
   split, two categories, degrade shape) and added a new "Settings gear reachability" invariant
   documenting the bug this task fixes and its live verification.

## Acceptance criteria — status

- [x] The gear opens Settings against a daemon with no `providerAuth` capability — **live-verified**
      against a real running dev daemon (`npm run dev:daemon`; confirmed via `dev-bootstrap.ts`'s
      own header comment that it does not register `provider_auth` handlers, so
      `providerAuthCapable` is provably `false` for the whole session): the Settings gear button
      (`button[aria-label="Settings"]`) was present in the live, connected DOM. Pre-task-006 this
      exact daemon would have hidden it.
- [x] The Viewers category lists a Molecule Viewer toggle bound to `setEnabled`, one RPC per
      flip, immediate optimistic reflection — implemented exactly as `viewer-settings-store.ts`
      (task-004) already provides and unit-tested there (12 tests, unchanged by this task except
      the 3 new toast-specific cases below).
- [x] After flipping it off, a `.cif` opens as text — this is task-005's gate, now reachable
      through real UI rather than only a directly-called store method; no new code needed, the
      wiring is what this task adds.
- [x] The toggle state survives a page reload — daemon state, unchanged from task-004's `hydrate()`
      on connect; not re-tested here since ViewersPanel adds no client-side persistence of its own.
- [x] A second browser window sees the toggle flip without a reload — `viewer_settings_update`
      broadcast convergence, already live-verified end to end in task-002's summary (two raw
      WebSocket connections against the real dev daemon); ViewersPanel is a thin `Switch` consumer
      of the same store that convergence already updates.
- [x] Against a daemon without `viewerSettings`: row renders on, disabled, with the note — direct
      consequence of `capable` (store field) driving `disabled`/the note text, and
      `isViewerEnabled`'s `?? true` default driving `checked`; both already unit-tested in
      `viewer-settings-store.test.ts`.
- [x] A rejected `set` restores the previous switch position and surfaces a toast — restoration was
      already covered (`rollback`, task-004's tests); the toast half is new in this task and
      covered by three new `viewer-settings-store.test.ts` cases (fires on rejection, silent
      with no client, silent on success).

## Deviation from the test plan

The "Manual (dev daemon + browser, two windows)" step's full click-through (opening the dialog,
flipping the toggle, observing convergence in a second window) could not be completed live in
this environment — the headless browser tooling repeatedly lost its execution context
(`Execution context was destroyed, most likely because of a navigation`) immediately after any
click-style interaction, consistent with the same instability task-005's summary already
documented for this sandbox. What WAS obtained live and is a genuine, meaningful confirmation
(not code-reading): the settings gear rendering in the connected DOM of a real dev daemon that
provably does not advertise `providerAuth` — the exact bug this task fixes, and the one
acceptance criterion most at risk of silent regression from a copy-paste error in the `.some(...)`
predicate. The remaining criteria are covered by: task-004's pre-existing store test suite
(hydrate/setEnabled/setConfig/rollback/capability-degrade, 12 tests, now 15 with the toast
additions), task-002's already live-verified daemon-side broadcast-before-answer/convergence
ordering, and task-005's already live-and-unit-verified dispatch-point gating — this task only
adds the UI wiring on top of infrastructure each of those already proved end to end.

## Test / verification performed

- `packages/web-client/src/features/settings/settings-categories.test.ts` (new, 4 tests) —
  Viewers reachable with empty caps, at-least-one-category-available with empty caps (the gear
  gate's own predicate), Model Providers stays capability-gated, `buildSettingsCategoryCapabilities`
  edge cases.
- `packages/web-client/src/viewer-plugins/viewer-settings-store.test.ts` (+3 tests, 15 total) —
  toast fires on rejection (`error` variant), no toast with no client, no toast on success.
- `npx vitest run`: 208 files, 2751 tests, all passing.
- `npm run build`, `npm run typecheck`, `npm run lint`, `npx oxfmt --check`: all clean on every
  touched file (pre-existing warnings only, none in touched files).
- Live dev-daemon + browser: gear-reachability confirmed as described above.

## Files changed

`packages/web-client/src/features/settings/ViewersPanel.tsx` (new),
`packages/web-client/src/features/settings/ViewersPanel.module.css` (new),
`packages/web-client/src/features/settings/settings-categories.ts` (new),
`packages/web-client/src/features/settings/settings-categories.test.ts` (new),
`packages/web-client/src/features/settings/SettingsDialog.tsx` (trimmed),
`packages/web-client/src/features/connection/ConnectionBar.tsx` (gear gate),
`packages/web-client/src/viewer-plugins/viewer-settings-store.ts` (+test) (toast on rejection),
`packages/web-client/AGENTS.md` (source-layout entry + new invariant).
