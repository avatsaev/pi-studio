# Task 006 — "Viewers" settings category + reachable settings gear

- **Sprint:** sprint-073-viewer-settings
- **Status:** done
- **Type:** feature
- **Area:** packages/web-client
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-004, task-005

## Goal

A "Viewers" category in the Settings dialog with a Molecule Viewer toggle, and a settings gear that
is reachable whenever *any* category is available — not only when the daemon supports provider auth.

## Context / why

Without this the kill switch has no user-facing control at all.

The gear gate is a real bug this task fixes, not incidental polish. `ConnectionBar.tsx:82` gates the
gear on `providerAuthCapable`, which was correct when Model Providers was the only category
(sprint-065). A capability-free Viewers category makes it wrong: against a daemon without
`providerAuth`, the gear stays hidden and the new category is unreachable — a settings page that
exists and cannot be opened. The fix is to derive the gate from the category registry rather than
duplicate per-category logic in the bar.

Degrade behavior matters as much as the happy path. Against a daemon that does not advertise
`viewerSettings`, the category still renders, but its rows are **read-only with a "requires a newer
daemon" note** — the same shape as the `providerAuth`-gated Model Providers category. A viewer is
never hidden because of a daemon version.

## Scope references

- `docs/MOLVIEWER_DECOUPLING.md` § 5 Phase 0 steps 3-4 (:483-493), § 7 semantics table (:663-665)
- `packages/web-client/src/features/settings/SettingsDialog.tsx` — `SettingsCategory` (:39-45),
  `SettingsCategoryCapabilities` (:33-36), `SETTINGS_CATEGORIES` (:55-63), caps build (:74-76),
  filter (:77)
- `packages/web-client/src/features/connection/ConnectionBar.tsx:82` — the gear gate
- `packages/web-client/src/components/primitives/Switch.tsx` — the toggle primitive
- `packages/web-client/src/viewer-plugins/viewer-settings-store.ts` (task-004)

## What to build

**Create `packages/web-client/src/features/settings/ViewersPanel.tsx`** (+ CSS module if the
existing panels use one — match `ModelProvidersPanel`). One `Switch` row labelled "Molecule Viewer"
with a one-line description, bound to `isViewerEnabled("molviewer")` and `setEnabled`. Hardcoding
the single row is correct for now; phase 4 of the decoupling plan makes it registry-driven, and
inventing the registry-driven version before the registry exists would be speculative.

- When `capable === false`: the switch is `disabled`, reads as on, and a short note reads
  "Requires a newer daemon." Do not hide the row.
- The switch reflects optimistic state immediately (the store owns rollback); a rejected RPC
  surfaces via the existing toast host rather than a bespoke inline error.

**Modify `SettingsDialog.tsx`.** Add the category entry:

```ts
{ id: "viewers", label: "Viewers", icon: <lucide icon>, component: ViewersPanel, available: () => true }
```

lazy-imported like `ModelProvidersPanel`. This is the first capability-independent category — the
`available` predicate shape already anticipates it, so no interface change is needed. Export
whatever the gear gate needs (see below) from this module so the registry stays the single source.

**Modify `ConnectionBar.tsx`.** Replace the `providerAuthCapable`-only gate with "any category is
available for these caps". Build the same `caps` object `SettingsDialog` builds (extract that into
a small shared helper in `SettingsDialog.tsx` rather than duplicating the `serverInfo?.features?.[…]`
reads) and check `.some((c) => c.available(caps))`. Keep deriving from `serverInfo`, not from the
`client` reference — the store's `client` is stable across reconnects while its feature map mutates
in place, so only `serverInfo` re-renders. Given `() => true` on the new category this means the
gear is now always shown; that is the intended outcome, and the `.some(...)` form is what keeps it
correct when a future category is capability-gated again.

**Modify `packages/web-client/AGENTS.md`.** The `settings/` source-layout paragraph (~:410-414)
currently asserts every category entry is capability-gated — now false. Rewrite it to describe the
registry with one capability-free entry, the new `ViewersPanel`, and the any-category-available gear
rule.

## Out of scope

- Registry-driven category rows (phase 4 of the decoupling plan).
- Per-viewer `config` editing UI — the store exposes `setConfig`, but molviewer declares no options
  today and inventing a settings surface for a plugin with nothing to configure is scope creep.

## Acceptance criteria

- [ ] The gear opens Settings against a daemon with **no** `providerAuth` capability.
- [ ] The Viewers category lists a Molecule Viewer toggle; flipping it off issues one
      `viewer_settings_set_request` and the switch reflects the new state immediately.
- [ ] After flipping it off, a `.cif` opens as text (task-005's gates, now driven by real UI).
- [ ] The toggle state survives a page reload (it is daemon state, re-hydrated on connect).
- [ ] A second browser window on the same daemon sees the toggle flip without a reload.
- [ ] Against a daemon without `viewerSettings`: the row renders on, disabled, with the
      "requires a newer daemon" note, and molecule files still open in the viewer.
- [ ] A rejected `set` restores the previous switch position and surfaces a toast.

## Test / verification plan

- Tests: extend/`add` a `SettingsDialog` test asserting the category list contains `viewers` for
  empty caps and that the gear-gate helper returns `true` with no capabilities at all. Assert
  behavior a consumer observes (category is reachable), not the shape of the array literal.
- Run: `npx vitest run packages/web-client` — all pass.
- Manual (dev daemon + browser, two windows): every acceptance criterion above, in order. The
  two-window convergence check and the reload check are the two that prove this is daemon state
  rather than a local preference.

## Notes

- The dev daemon must have task-002's handlers registered for the manual pass to exercise the real
  path; if the toggle silently no-ops in dev, check `dev-bootstrap.ts` registration first.
- Do not add a `viewerSettings` field to `SettingsCategoryCapabilities`. The category is
  capability-*independent* — the capability only decides whether its rows are editable, which is the
  panel's concern, not the registry's.
