# Task 004 — `viewer-settings-store.ts` + connection-driven hydration

- **Sprint:** sprint-073-viewer-settings
- **Status:** backlog
- **Type:** feature
- **Area:** packages/web-client
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-003

## Goal

A Zustand store holding the daemon's viewer settings, hydrated on connect, replaced by every
`viewer_settings_update` push, reset on disconnect, with an optimistic `setEnabled` that rolls back
on RPC rejection — plus the boot hook that drives it.

## Context / why

This store is the single answer to "is viewer X enabled?" for the whole client. Task-005 gates five
dispatch points on it, and phase 3 of the decoupling plan hands the same predicate to the plugin
registry unchanged — so its shape has to be right now, not later.

Two decisions the shape encodes:

- **`isViewerEnabled(id) = viewers[id]?.enabled ?? true`.** Absent row, unhydrated store, and
  capability-free daemon all mean *enabled*. The failure direction is always "offer the viewer",
  never "hide the user's file".
- **`loaded` is a real field, not derived.** The layout replay (task-005) waits on it. Deriving it
  from `Object.keys(viewers).length` would be wrong, because an empty document is a legitimate
  hydrated state.

The store must NOT mirror `appearance-store.ts`'s `localStorage` shape. This state lives on the
daemon; a second local copy would be a second source of truth, and the two would disagree the first
time a phone toggled a viewer.

## Scope references

- `docs/MOLVIEWER_DECOUPLING.md` § 5 Phase 0 step 1 (:454-463), § 4.4 rules (:419-438), § 8 client
  test list (:716-718)
- `packages/web-client/src/stores/connection-store.ts` — `status`, `client`, `disconnect()` (:130)
- `packages/web-client/src/app.tsx:11-21` — the `Boot` component where lifecycle hooks are mounted
- `packages/client/AGENTS.md` — the four facade methods added by task-003

## What to build

**Create `packages/web-client/src/viewer-plugins/viewer-settings-store.ts`.** (This directory is new
— phase 1 fills it with the plugin contract; the store lands here first because it is the
registry's future enabled-filter, not a generic app store.)

```ts
interface ViewerSettingsState {
  loaded: boolean;
  capable: boolean;                       // daemon advertised `viewerSettings`
  viewers: Record<string, { enabled: boolean; config?: Record<string, unknown> }>;
  isViewerEnabled(id: string): boolean;   // viewers[id]?.enabled ?? true
  hydrate(): Promise<void>;               // get → replace; sets loaded
  applyUpdate(settings: ViewerSettings): void;  // wholesale replace from a push
  setEnabled(id: string, enabled: boolean): Promise<void>;  // optimistic + rollback
  setConfig(id: string, config: Record<string, unknown>): Promise<void>;  // same posture
  reset(): void;                          // loaded:false, viewers:{} — on disconnect
}
```

- `hydrate()` against a **capability-free daemon** sets `capable: false`, `loaded: true`,
  `viewers: {}` without issuing an RPC. `loaded` must become `true` on that path too, or the layout
  replay never runs against an older daemon.
- `hydrate()` on RPC failure also sets `loaded: true` (all-enabled degrade). A failed fetch must not
  wedge the app's tab restore.
- `setEnabled` applies locally first, awaits `setViewerSettings`, and on rejection restores the
  **previous row value** (including `undefined` — an absent row must roll back to absent, not to
  `{ enabled: true }`, or a subsequent config patch would carry a phantom row).
- `applyUpdate` replaces `viewers` wholesale — the daemon's document is authoritative, and a merge
  would resurrect rows another client deleted.
- `isViewerEnabled` is exposed both as a store action and as a module-level
  `isViewerEnabled(id)` reading `getState()`, so non-React callers (`reopenClientTabs`) can build
  the injected predicate without a hook.

**Create `packages/web-client/src/hooks/use-viewer-settings.ts`** exporting `useViewerSettingsBoot()`:
subscribe to `connection-store`'s `status`; on transition to `open` call `hydrate()`; on leaving
`open` call `reset()`. Mount it in `app.tsx`'s `Boot`, **after `useConnectionBoot()` and before
`usePaneLayoutBoot()`** — ordering is not load-bearing (task-005's gate is the `loaded` flag, not
hook order) but it keeps the read order legible.

## Out of scope

- Gating any dispatch point or the layout replay (task-005).
- The Settings UI that calls `setEnabled` (task-006). This task ships the store with no UI caller;
  its tests are the only consumer until then.

## Acceptance criteria

- [ ] Fresh store, nothing hydrated: `loaded === false` and `isViewerEnabled("anything") === true`.
- [ ] After `hydrate()` against a daemon reporting `{ molviewer: { enabled: false } }`:
      `loaded === true`, `isViewerEnabled("molviewer") === false`,
      `isViewerEnabled("other") === true`.
- [ ] Against a daemon without the `viewerSettings` capability: no RPC is issued, `capable === false`,
      `loaded === true`, everything enabled.
- [ ] A `viewer_settings_update` push replaces local state wholesale (a row present locally but
      absent in the push is gone afterward).
- [ ] `setEnabled` flips state before the RPC resolves, and on rejection restores the exact prior
      value — including restoring "no row at all".
- [ ] Disconnect resets `loaded` to `false`; a subsequent reconnect re-hydrates.

## Test / verification plan

- Tests: `packages/web-client/src/viewer-plugins/viewer-settings-store.test.ts` with a stub client
  object exposing the four facade methods (`getViewerSettings`, `setViewerSettings`,
  `onViewerSettingsUpdate`, `hasViewerSettingsCapability`) — no real transport. Cover every
  acceptance criterion above; the rollback-to-absent case and the capability-free path are the two
  that a plausible bug actually breaks.
- Run: `npx vitest run packages/web-client` — all pass.
- Typecheck: `npm run typecheck` succeeds.

## Notes

- The repo has no existing daemon-backed Zustand store to copy verbatim: `provider-auth-store.ts`
  is UI-local (pending-login state only) and `use-provider-auth-list.ts` is TanStack Query. This
  store is the first of its shape — hence the explicit contract above rather than "follow the
  existing pattern". If a later reviewer asks why this is not a query: the layout replay needs a
  synchronous, non-React read (`getState().isViewerEnabled`), which a query cache does not offer
  cleanly.
- Subscribe to the `viewer_settings_update` push once, from the boot hook, and store the
  unsubscribe — not per component.
