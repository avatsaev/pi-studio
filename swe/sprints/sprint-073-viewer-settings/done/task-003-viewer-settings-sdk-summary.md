# Task 003 — `PiStudioClient` viewer-settings facade — Summary

- **Sprint:** sprint-073-viewer-settings
- **Completed:** 2026-09-10
- **Status:** done

## What was implemented

Four stateless pass-through methods on `PiStudioClient` (`packages/client/src/pistudio-client.ts`),
grouped in a new `// ─── Viewer settings (viewer_settings_*, sprint-073) ───` section right after
the provider-auth group and before Extension UI:

- `hasViewerSettingsCapability(): boolean` — `this.daemon.hasFeature("viewerSettings")`.
- `getViewerSettings(): Promise<ViewerSettings>` — issues `viewer_settings_get_request`, returns
  `payload.settings`.
- `setViewerSettings(patch: ViewerSettingsPatch): Promise<ViewerSettings>` — issues
  `viewer_settings_set_request` with `{ patch }`, returns the response's effective
  `payload.settings` (never an echo of the patch it sent).
- `onViewerSettingsUpdate(handler): () => void` — filters `msg.type === "viewer_settings_update"`
  inside `daemon.onSessionMessage(...)`, returns the unsubscribe closure directly.

A new exported type alias, `ViewerSettingsPatch = Record<string, ViewerSettingsPatchEntry>`, sits
alongside the method group (mirrors the server-side `viewer-settings-state.ts` alias of the same
name) so a consumer (task-004's store) has a name for the patch shape without reaching into
`ViewerSettingsSetRequest["patch"]` directly.

No `DaemonClient` change was needed — `request()`, `onSessionMessage()`, and `hasFeature()` were
already sufficient, confirming the task's stated expectation.

## Files created / changed

| File | Change |
|------|--------|
| `packages/client/src/pistudio-client.ts` | modified — 4 new type imports, `ViewerSettingsPatch` type alias, 4 new facade methods |
| `packages/client/src/pistudio-client.test.ts` | modified — new `describe("PiStudioClient — viewer settings (sprint-073)", …)` block, 4 tests |
| `packages/client/src/test-support/scripted-daemon.ts` | modified — added `viewer_settings_get_request`/`viewer_settings_set_request` auto-reply cases to the scripted daemon's `respond()` dispatcher (unlike `provider_auth_*`, these are simple stateless pass-throughs with no ordering-sensitive flow, so an automatic reply is appropriate, matching the `extension_packs_*` precedent) |
| `packages/client/AGENTS.md` | modified — 4 new rows in the `### Methods` table |

## How it satisfies the scope

Matches `docs/MOLVIEWER_DECOUPLING.md` § 4.4's `packages/client` contribution row and the task's
"What to build" section exactly — same method names, same signatures, same placement next to the
provider-auth group. No deviations.

## Build & test results

```
$ npm run build:client
> tsc -b packages/client
(success)

$ npm run build   (full workspace)
(success)

$ npm run typecheck
(success, no output)

$ npx oxlint packages/client/src/pistudio-client.ts packages/client/src/pistudio-client.test.ts \
    packages/client/src/test-support/scripted-daemon.ts
(no output — 0 warnings/errors)

$ npm run lint   (full workspace)
(exit 0; all warnings pre-existing in files untouched by this task)

$ npx oxfmt --check <3 touched files>
All matched files use the correct format.

$ npx vitest run packages/client
 Test Files  8 passed (8)
      Tests  163 passed (163)

$ npx vitest run   (full workspace)
 Test Files  205 passed (205)
      Tests  2729 passed (2729)
```

## Acceptance criteria

- [x] `getViewerSettings()` issues exactly one `viewer_settings_get_request` and resolves to the
      response's `settings` document (verified: "getViewerSettings sends... and returns the
      response's settings document").
- [x] `setViewerSettings(patch)` issues `viewer_settings_set_request` carrying that patch verbatim
      and resolves to the effective document from the response (verified: "setViewerSettings
      sends... carrying the patch verbatim and returns the effective document").
- [x] `onViewerSettingsUpdate(cb)` fires `cb` for a pushed `viewer_settings_update` and does not
      fire for any other pushed session message; its returned function unsubscribes (verified: one
      test covers all three — an unrelated `agent_update` push, a real push, and post-unsubscribe
      silence).
- [x] `hasViewerSettingsCapability()` is `true` only when the fake daemon advertises the flag
      (verified: both branches asserted in one test).
- [x] `packages/client/AGENTS.md`'s Methods table lists all four (verified by direct read of the
      updated file).

## Follow-ups / TODO(verify)

- None. Store/caching/reconnect-rehydration logic (task-004) and retry/backoff on a rejected `set`
  (the store's optimistic-rollback decision) are explicitly out of scope here per the task file.
