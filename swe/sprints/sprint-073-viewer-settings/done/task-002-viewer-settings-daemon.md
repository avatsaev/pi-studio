# Task 002 — Daemon `viewers/` subsystem: persistence, handlers, broadcast

- **Sprint:** sprint-073-viewer-settings
- **Status:** done
- **Type:** feature
- **Area:** packages/server
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** task-001

## Goal

A new `packages/server/src/viewers/` subsystem that persists per-viewer settings to
`$PI_STUDIO_HOME/viewer-settings.json`, serves `viewer_settings_get`/`_set`, and broadcasts
`viewer_settings_update` to every active session on every successful set.

## Context / why

This is the durable half of the runtime kill switch. The daemon is the right home for it because two
clients on the same daemon (a browser and a relay-connected phone) must converge on one answer, and
because the setting outlives any one browser profile.

The subsystem is deliberately **plugin-ignorant**: it stores rows keyed by whatever id arrives,
never validates ids against a list, and treats `config` as an opaque blob. That is § 3's dependency
rule (core never knows a specific plugin) applied across the wire. An unknown viewer id is a valid
row, not an error — a newer client with a viewer this daemon has never heard of must still be able
to persist a preference.

**Absent row = enabled.** Defaults are never written, so a fresh daemon's file is `{}`-shaped and a
daemon that has never had this feature look identical to a client.

## Scope references

- `docs/MOLVIEWER_DECOUPLING.md` § 4.4 (rules at 419-438; contribution table row at 403), § 8 test
  list (`viewer-settings-rpc.test.ts` at 710-713), § 9 risk row (concurrent toggles at 732)
- `packages/server/src/extensions/extensions-state.ts` — the state-module shape to mirror
  (schema consts, `…Path(home)` resolver at :69-71, save via `atomicWriteJson` at :92-94)
- `packages/server/src/persistence/atomic-store.ts` — `atomicWriteJson` (:27-51), `loadStore` (:63-78)
- `packages/server/src/extensions/extensions-rpc.ts` — registrar/handler/deps shape (:15-18, :39-49);
  domain failures answer `{ ok:false, error }`, never `rpc_error`
- `packages/server/src/terminal/terminal-rpc.ts:37` — the unconditional broadcast-to-all precedent
- `packages/server/src/agent/slash-command-operations.ts:216-221` — broadcast **before** answering
- `packages/server/src/daemon/bootstrap.ts:518` — registration site (after `registerFileWatchHandlers`)
- `packages/server/src/daemon/dev-bootstrap.ts:64-82, 154` — dev broadcast helper,
  `getActiveSessions`, and the `registerAgentUiHandlers` registration precedent
- `packages/server/AGENTS.md` — source-layout tree (`extensions/` entry at :171), Persistence
  section (:1170-1183), `### Extensions sync (extensions/)` (:1185) as the section-heading style

## What to build

**Create `packages/server/src/viewers/viewer-settings-state.ts`.**

```ts
export const viewerSettingsPath = (home: string) => join(home, "viewer-settings.json");
export async function loadViewerSettings(home: string): Promise<ViewerSettings>;
export async function saveViewerSettings(home: string, settings: ViewerSettings): Promise<void>;
export function applyViewerSettingsPatch(current: ViewerSettings, patch: ViewerSettingsPatch): ViewerSettings;  // pure
```

- Reuse `viewerSettingsSchema` from `@av-pi-studio/protocol` — do **not** redeclare it server-side.
- `load` uses `loadStore(path, viewerSettingsSchema, { version: 1, viewers: {} })`, i.e. the
  **soft-fallback** contract: absent, malformed, or schema-mismatched file → all-enabled defaults,
  logged at `warn`. This deliberately differs from `extensions-state.ts`'s `"unreadable"` sentinel:
  extensions must not silently re-offer packages after a corrupt read, whereas a viewer setting that
  cannot be read must degrade to *offering* the viewer — never to hiding a file. Record that
  reasoning in a comment at the loader.
- `applyViewerSettingsPatch` is pure and exported for direct unit test. Per-viewer merge: a patch
  entry's present fields overwrite, absent fields are preserved from the current row; a viewer id
  not present in `current` is created with `enabled` defaulting to `true` when the patch omits it.
  No deletion semantics.
- `home` is a parameter, never read from `process.env` here (matches `extensions-state.ts`).

**Create `packages/server/src/viewers/viewer-settings-rpc.ts`.**

```ts
export interface ViewerSettingsRpcDeps {
  home: string;
  broadcast: (sessions: Iterable<Session>, message: unknown) => void;
  getActiveSessions: () => Iterable<Session>;
  logger?: Logger;
}
export function registerViewerSettingsHandlers(registry: HandlerRegistry, deps: ViewerSettingsRpcDeps): void;
```

- `viewer_settings_get_request` → `{ payload: { settings: await loadViewerSettings(home) } }`.
- `viewer_settings_set_request`:
  1. validate `ctx.message.patch` defensively (`ctx.message` is unvalidated wire data — see the
     `isSlugArray` precedent at `extensions-rpc.ts:36-38`); a malformed patch answers a domain error,
     not `rpc_error`,
  2. load → `applyViewerSettingsPatch` → `saveViewerSettings`,
  3. **broadcast `{ type: "viewer_settings_update", settings }` to `getActiveSessions()` — including
     the caller — before returning**, so no session ever observes a success while another is stale
     (`slash-command-operations.ts:216-221` ordering),
  4. answer `{ payload: { settings } }` with the effective post-merge document, re-derived, never an
     echo of the request.
- **Serialize the read-modify-write.** Two clients toggling concurrently must not lose a row: hold a
  module-local `let queue: Promise<unknown> = Promise.resolve()` inside the registrar and chain each
  `set` onto it. "Last write wins" is the *semantic* rule; a lost-update race is a bug, not a
  semantic.
- An unknown viewer id is accepted and persisted. Never validate against a list.

**Register in both bootstraps.**

- `bootstrap.ts`: `registerViewerSettingsHandlers(registry, { home, broadcast, getActiveSessions, logger })`
  immediately after the `registerExtensionsHandlers(...)` call at :518.
- `dev-bootstrap.ts`: same call, with `home: "/tmp/pi-studio-dev"` (the value `AgentManager` already
  uses at :94) and the module-local `broadcast`/`getActiveSessions`. Unlike extensions, this
  subsystem **must** exist in dev — the web client is developed against the dev daemon, and without
  it every dev session runs the capability-absent degrade path and can never exercise the toggle.

**Modify `packages/server/AGENTS.md`.** Add the `viewers/` directory to the source-layout tree with
its two file one-liners, add `viewer-settings.json` to the Persistence entity-file list
(:1171-1183), and add a `### Viewer settings (viewers/)` subsystem section with the invariants:
daemon knows nothing about plugins, absent row = enabled, `config` opaque, last-write-wins with a
serialized read-modify-write, broadcast includes the caller.

## Out of scope

- The `viewerSettings` feature flag's declaration (task-001) — this task only benefits from it being
  advertised by the existing `SERVER_FEATURES`-wholesale mechanism at `bootstrap.ts:816`; verify that
  the flag reaches `server_info.features` on both the direct WS and relay paths, and fix only if it
  does not.
- Any client-side consumption.

## Acceptance criteria

- [ ] `get` on a daemon with no `viewer-settings.json` answers `{ version: 1, viewers: {} }` and
      creates no file.
- [ ] `set` with `{ molviewer: { enabled: false } }` persists, answers the effective document, and
      leaves exactly one file (`viewer-settings.json`, no `.tmp`) in `$PI_STUDIO_HOME`.
- [ ] A second session connected to the same daemon receives `viewer_settings_update` with the same
      document; the calling session receives it too.
- [ ] `set` with an unknown viewer id succeeds and the row round-trips through `get`.
- [ ] A config-only patch preserves the row's existing `enabled`; an enabled-only patch preserves its
      existing `config`.
- [ ] A corrupt `viewer-settings.json` makes `get` answer all-enabled defaults and logs a warning;
      the corrupt file is not rewritten by the read itself.
- [ ] Two concurrent `set`s on two different viewer ids both survive (no lost update).
- [ ] Handlers are registered in `bootstrap.ts` **and** `dev-bootstrap.ts`.

## Test / verification plan

- Tests: `packages/server/src/viewers/viewer-settings-state.test.ts` — mkdtemp fixture
  (`extensions-state.test.ts:16-18` shape); round-trip, no-`.tmp`-left-behind, passthrough survival,
  absent-file default, corrupt-file fallback; plus direct unit tests of the pure
  `applyViewerSettingsPatch` merge cases.
- Tests: `packages/server/src/viewers/viewer-settings-rpc.test.ts` — `boot(home)` helper
  (`extensions-rpc.test.ts:60-75` shape), drive requests through the real router via
  `dispatch(registry, message)` (:78-91), parse every response with the protocol schemas from
  task-001, and assert the broadcast by registering **two** fake sessions and checking both received
  `viewer_settings_update`.
- Run: `npx vitest run packages/server` — all pass.
- Manual: `npm run dev:daemon`, then from a `ws` one-liner or the browser console send
  `viewer_settings_set_request` and confirm the `viewer_settings_update` push arrives on a second
  connection.

## Notes

- `STORE_SUBDIRECTORIES` (`atomic-store.ts:20`) does not include `viewers` — this is a bare
  top-level file next to `extensions-state.json`, not a managed subdirectory. Do not add it.
- The dev daemon writes to `/tmp/pi-studio-dev`; that directory may not exist on a fresh boot.
  `atomicWriteJson` writes a temp file in the target's directory, so ensure the directory exists
  before the first save (mkdir-recursive in the state module's save, or reuse whatever
  `AgentManager` already relies on — check before adding a second mechanism).
