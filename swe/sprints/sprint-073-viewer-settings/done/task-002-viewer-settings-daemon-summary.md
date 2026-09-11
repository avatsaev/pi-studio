# Task 002 — Daemon `viewers/` subsystem: persistence, handlers, broadcast — Summary

- **Sprint:** sprint-073-viewer-settings
- **Completed:** 2026-09-10
- **Status:** done

## What was implemented

A new `packages/server/src/viewers/` subsystem:

- **`viewer-settings-state.ts`** — `viewerSettingsPath(home)`, `loadViewerSettings(home, logger?)`
  (soft-fallback: absent/corrupt/schema-mismatched file → `{ version: 1, viewers: {} }`, warn-logged
  only on an actual read failure, deliberately NOT `extensions-state.ts`'s `"unreadable"`
  sentinel), `saveViewerSettings(home, settings)` (atomic write via `atomicWriteJson`), and the pure
  `applyViewerSettingsPatch(current, patch)` merge (present patch fields overwrite, absent fields
  preserved, new rows default `enabled: true`, no deletion semantics).
- **`viewer-settings-rpc.ts`** — `registerViewerSettingsHandlers(registry, deps)`: `get` answers the
  current document; `set` validates `patch`'s shape defensively (`isViewerSettingsPatch`, matching
  `extensions-rpc.ts`'s `isSlugArray` posture — a malformed patch is a no-op domain response, since
  this response schema carries no `ok`/`error` channel to reject through), serializes its
  read-modify-write through a module-local promise queue (survives concurrent patches to different
  viewer ids without a lost update), then broadcasts `viewer_settings_update` to every active
  session — including the caller — **before** answering.

Registered in both `bootstrap.ts` (after `registerExtensionsHandlers`, with the real `home`/
`broadcast`/`getActiveSessions`) and `dev-bootstrap.ts` (after `registerAgentUiHandlers`, with
`home: "/tmp/pi-studio-dev"`) — unlike extensions, which is production-only.

Confirmed (not modified — verification only) that the `viewerSettings` feature flag reaches
`server_info.features` on both the direct WS path (`ws-server.ts`'s `defaultFeatures()`) and the
relay path (`bootstrap.ts:816`'s `Object.fromEntries(Object.values(SERVER_FEATURES)...)`) via the
existing wholesale mechanism — no fix was needed.

## Files created / changed

| File | Change |
|------|--------|
| `packages/server/src/viewers/viewer-settings-state.ts` | created |
| `packages/server/src/viewers/viewer-settings-rpc.ts` | created |
| `packages/server/src/viewers/viewer-settings-state.test.ts` | created — 13 tests |
| `packages/server/src/viewers/viewer-settings-rpc.test.ts` | created — 7 tests |
| `packages/server/src/daemon/bootstrap.ts` | modified — import + registration |
| `packages/server/src/daemon/dev-bootstrap.ts` | modified — import + registration |
| `packages/server/AGENTS.md` | modified — `viewers/` source-layout tree entry, `viewer-settings.json` in the Persistence entity-file list, new `### Viewer settings (viewers/)` subsystem section |

## How it satisfies the scope

Maps to `docs/MOLVIEWER_DECOUPLING.md` § 4.4 (rules) and the task's "What to build" section.
Deviation from the task's literal suggestion: `loadViewerSettings` hand-rolls its
read+parse (mirroring `extensions-state.ts`'s own actual manual shape) rather than calling the
generic `loadStore` helper, because `loadStore` has no hook to log a warning distinctly on a read
failure versus an ordinary missing file — an explicit acceptance criterion here. `set`'s
malformed-patch response returns the current unchanged document rather than an `{ ok: false,
error }` shape, because task-001's already-verified `viewer_settings_set_response` schema declares
no `ok`/`error` field (unlike `provider_auth_*`/`extension_packs_*`); this is recorded as a design
decision in both the RPC file's comments and this summary, not a silent gap.

## Build & test results

```
$ npm run build:server
> tsc -b packages/server && chmod +x packages/server/dist/daemon/main.js
(success)

$ npm run build   (full workspace, all 7 packages)
(success)

$ npm run typecheck
(success, no output)

$ npx oxlint packages/server/src/viewers/ packages/server/src/daemon/bootstrap.ts packages/server/src/daemon/dev-bootstrap.ts
(0 warnings/errors after hoisting one `noop` helper to module scope)

$ npm run lint   (full workspace)
(exit 0; all warnings pre-existing in files untouched by this task)

$ npx oxfmt --check <all touched .ts files>
All matched files use the correct format.

$ npx vitest run packages/server/src/viewers
 Test Files  2 passed (2)
      Tests  20 passed (20)

$ npx vitest run   (full workspace)
 Test Files  205 passed (205)
      Tests  2725 passed (2725)
```

**Manual E2E** against `npm run dev:daemon` (real WS connections, no test harness): two sessions
connected and sent `hello`; `server_info.features.viewerSettings` was `true`;
`viewer_settings_get_request` on a fresh daemon answered `{ version: 1, viewers: {} }`;
`viewer_settings_set_request` from session 1 (`{ molviewer: { enabled: false } }`) produced, on
session 1: `viewer_settings_update` **then** `viewer_settings_set_response` (broadcast-before-answer
confirmed), and on session 2 (uninvolved in the request): the same `viewer_settings_update` push —
confirming multi-client convergence live. `/tmp/pi-studio-dev/viewer-settings.json` was written with
the exact merged document.

## Acceptance criteria

- [x] `get` on a daemon with no `viewer-settings.json` answers `{ version: 1, viewers: {} }` and
      creates no file (unit test + live E2E).
- [x] `set` with `{ molviewer: { enabled: false } }` persists, answers the effective document, and
      leaves exactly one file (`viewer-settings.json`, no `.tmp`) in `$PI_STUDIO_HOME` (unit test +
      live E2E, file content confirmed).
- [x] A second session connected to the same daemon receives `viewer_settings_update` with the same
      document; the calling session receives it too (unit test + live E2E).
- [x] `set` with an unknown viewer id succeeds and the row round-trips through `get` (unit test).
- [x] A config-only patch preserves the row's existing `enabled`; an enabled-only patch preserves its
      existing `config` (unit tests at both the pure-function and RPC layer).
- [x] A corrupt `viewer-settings.json` makes `get` answer all-enabled defaults and logs a warning;
      the corrupt file is not rewritten by the read itself (unit test, both corrupt-JSON and
      schema-mismatch cases).
- [x] Two concurrent `set`s on two different viewer ids both survive (no lost update) (unit test
      driving both through the router concurrently via `Promise.all`).
- [x] Handlers are registered in `bootstrap.ts` **and** `dev-bootstrap.ts` (verified by reading both
      files; live E2E ran against the dev bootstrap).

## Follow-ups / TODO(verify)

- None. Client SDK methods (task-003), stores/UI (tasks 004-006), and the root `AGENTS.md` §
  Protocol/persistence entries (task-007) are explicitly out of scope here per the task file.
