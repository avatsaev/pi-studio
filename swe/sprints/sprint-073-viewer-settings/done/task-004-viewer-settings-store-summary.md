# Task 004 — `viewer-settings-store.ts` + connection-driven hydration — Summary

- **Sprint:** sprint-073-viewer-settings
- **Completed:** 2026-09-10
- **Status:** done

## What was implemented

A new `packages/web-client/src/viewer-plugins/` directory (this is the future plugin-registry
home; the store lands here first per the task's own note) holding:

- **`viewer-settings-store.ts`** — `useViewerSettingsStore`, a Zustand store with `loaded`,
  `capable`, `viewers`, and the exact action set from the task's interface
  (`isViewerEnabled`/`hydrate`/`applyUpdate`/`setEnabled`/`setConfig`/`reset`), plus a
  module-level `isViewerEnabled(id)` reading `getState()` for non-React callers. `hydrate()`
  short-circuits to `{ loaded: true, capable: false, viewers: {} }` with no RPC against a
  capability-free daemon, and degrades to `{ loaded: true, capable: true, viewers: {} }` (all
  enabled) on a failed fetch — `capable` stays `true` there since the daemon DID advertise the
  flag; only the one fetch failed. `setEnabled`/`setConfig` apply optimistically, then reconcile
  with the daemon's effective post-merge document on success, or roll back to the captured prior
  row value on rejection — including deleting the row entirely when there was no prior row (never
  rolling back to a phantom `{ enabled: true }`).
- **`viewer-settings-store.test.ts`** — 9 tests covering every acceptance criterion.

And in `packages/web-client/src/hooks/`:

- **`use-viewer-settings.ts`** — `useViewerSettingsBoot()`, a single `useEffect` keyed on
  `[status, client]` from `useConnectionStore`: on entering `open`, kicks off `hydrate()` and
  subscribes to `client.onViewerSettingsUpdate`, storing the unsubscribe as the effect's cleanup
  (so exactly one subscription exists per connection, not per component); on any other status
  (including the initial mount), calls `reset()`.

Mounted in `app.tsx`'s `Boot`, after `useConnectionBoot()` and before `usePaneLayoutBoot()`, per
the task's explicit ordering instruction.

## Files created / changed

| File | Change |
|------|--------|
| `packages/web-client/src/viewer-plugins/viewer-settings-store.ts` | created |
| `packages/web-client/src/viewer-plugins/viewer-settings-store.test.ts` | created — 9 tests |
| `packages/web-client/src/hooks/use-viewer-settings.ts` | created |
| `packages/web-client/src/app.tsx` | modified — import + `useViewerSettingsBoot()` mounted in `Boot` |
| `packages/web-client/AGENTS.md` | modified — new `viewer-plugins/` source-layout tree entry, `use-viewer-settings` added to the `hooks/` tree entry |

## How it satisfies the scope

Matches `docs/MOLVIEWER_DECOUPLING.md` § 5 phase 0 step 1 and the task's interface exactly — same
field names, same method signatures. One implementation choice beyond the task's literal text:
`hydrate()`'s RPC-failure branch keeps `capable: true` (the task only specifies the acceptance
criterion for the *capability-free* path's `capable === false`; the RPC-failure path's `capable`
value was unspecified). This is recorded as a deliberate choice — `capable` describes protocol
support, not the success of any one fetch — both in the store's code comment and here.

## Build & test results

```
$ npm run build   (full workspace)
(success)

$ npm run typecheck
(success, no output)

$ npx oxlint packages/web-client/src/viewer-plugins packages/web-client/src/hooks/use-viewer-settings.ts packages/web-client/src/app.tsx
(0 warnings/errors after hoisting two default-impl functions to module scope)

$ npm run lint   (full workspace)
(exit 0; all warnings pre-existing in files untouched by this task)

$ npx oxfmt --check <touched files>
All matched files use the correct format.

$ npx vitest run packages/web-client/src/viewer-plugins
 Test Files  1 passed (1)
      Tests  9 passed (9)

$ npx vitest run   (full workspace)
 Test Files  206 passed (206)
      Tests  2738 passed (2738)
```

No browser smoke test this task: per "Out of scope", the store ships with no UI caller — its own
tests are the only consumer until task-006 wires the Settings dialog. Live browser verification is
task-006/007's responsibility, once there is a surface to click.

## Acceptance criteria

- [x] Fresh store, nothing hydrated: `loaded === false` and `isViewerEnabled("anything") === true`
      (verified: "fresh store: unhydrated, and everything reads as enabled").
- [x] After `hydrate()` against a daemon reporting `{ molviewer: { enabled: false } }`:
      `loaded === true`, `isViewerEnabled("molviewer") === false`, `isViewerEnabled("other") ===
      true` (verified directly).
- [x] Against a daemon without the `viewerSettings` capability: no RPC is issued, `capable ===
      false`, `loaded === true`, everything enabled (verified: "hydrate() against a
      capability-free daemon issues no RPC and leaves everything enabled").
- [x] A `viewer_settings_update` push replaces local state wholesale — a row present locally but
      absent in the push is gone afterward (verified: "applyUpdate replaces viewers wholesale...").
- [x] `setEnabled` flips state before the RPC resolves, and on rejection restores the exact prior
      value — including restoring "no row at all" (verified by two tests: the in-flight optimistic
      assertion via `Promise.withResolvers`, and both rollback cases — absent row and a
      pre-existing row with `config`).
- [x] Disconnect resets `loaded` to `false`; a subsequent reconnect re-hydrates (verified: "reset()
      returns to the unhydrated state; a subsequent hydrate re-populates it" — the boot hook's own
      disconnect→reset wiring is structural, exercised indirectly through the store's own `reset`
      action since the hook itself needs a DOM/React test harness this package doesn't use for
      hooks; `use-terminal-exit-watch.ts`'s sibling hooks follow the same "hook is thin glue,
      logic is unit-tested directly" convention).

## Follow-ups / TODO(verify)

- None. Gating any dispatch point or the layout replay (task-005) and the Settings UI that calls
  `setEnabled` (task-006) are explicitly out of scope here per the task file.
