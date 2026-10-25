# Task 004 — `ResourceService` list + toggle, file watcher, `skills_*` handlers, production bootstrap

- **Sprint:** sprint-075-skills-list-toggle
- **Completed:** 2026-10-25
- **Status:** done

## What was implemented

- `packages/server/src/resources/wire.ts` — `toSkillInfo(List)`/`toPiPackageInfo(List)`: the ONE
  mapping from `skill-catalog.ts`'s internal `CatalogSkill`/`CatalogPackage` to the wire's
  `SkillInfo`/`PiPackageInfo` (`packages/protocol`), dropping the internal-only `baseDir`. The
  nested `provenance` field is rebuilt as a fresh object literal at the call site (not the
  `CatalogSkill` reference directly) — required for the zod `.passthrough()`-widened target type,
  which carries an implicit index signature a plain `SkillProvenance` interface reference can't
  satisfy structurally.
- `packages/server/src/resources/resource-service.ts` — `ResourceService`:
  - `ctx()` (`buildCtx`): `agentDir = effectivePiHomeKey(config)`, `home = homedir()` (the real OS
    home — `~/.agents/skills` resolves from it, not `agentDir`), `lockPath` =
    `$XDG_STATE_HOME/skills/.skill-lock.json` if set else `$HOME/.agents/.skill-lock.json`.
  - `list()`: starts the watcher, re-resolves `buildCatalog(ctx())`, maps via `wire.ts`.
  - `setEnabled(path, enabled)`: re-resolves the catalog, finds the row by `path` (absent ⇒
    `not_found`, echoing the current list), opens a fresh `SettingsManager` via `pi-sdk.ts`'s
    `openPiResources`, derives the toggle pattern via `toggle-patterns.ts`
    (`topLevelPattern`/`packagePattern`), writes through `SettingsManager#setSkillPaths`/
    `#setPackages` (for a package row: `applyPackageToggle` over `settings.getPackages()`), marks
    the fold window (`markOwnWrite()`) immediately before the mutating setter, `await flush()`,
    broadcasts `skills_changed("mutation")` **before** returning a freshly re-resolved list.
    A package row whose entry vanished mid-toggle (concurrent `pi remove`/hand-edit — a genuine
    race, not a client bug) is caught and surfaced as the same domain `not_found`, never an
    uncaught throw reaching the router's `rpc_error` path.
  - Watcher: `ensureWatcher()` — started lazily on the first `list()`/`setEnabled()` call, never at
    bootstrap. Subscribes `<agentDir>/settings.json`, `<agentDir>/skills`, `~/.agents/skills`, and
    the lock file via the shared `FileWatchService`. A 500 ms debounce (`externalDebounceMs`,
    overridable for tests) collapses a burst into one `skills_changed("external")`. Own-write
    fold: `markOwnWrite()` sets `ownWriteUntil = Date.now() + externalDebounceMs` right before the
    mutating setter; an fs event arriving before that deadline is dropped outright (never even
    schedules a debounce timer) — folded into the mutation's own broadcast instead of producing a
    second, redundant `"external"` push for a change the daemon made itself.
- `packages/server/src/resources/skills-rpc.ts` — `registerSkillsHandlers`:
  `skills_list_request`/`skills_set_enabled_request`, thin pass-through onto `ResourceService`.
  `ctx.message` is an unvalidated `Record<string, unknown>`, so `set_enabled` validates `path`
  (`string`)/`enabled` (`boolean`) itself (mirrors `extensions-rpc.ts`'s `isSlugArray` posture); a
  malformed shape answers a domain `{ok:false, error:"invalid request: …"}`, echoing the current
  list, never an `rpc_error`.
- `packages/server/src/daemon/bootstrap.ts` — wires `ResourceService` + `registerSkillsHandlers`
  right after `registerViewerSettingsHandlers`, reusing the already-constructed shared
  `fileWatchService`/`broadcast`/`getActiveSessions`/`config`. **Not** wired into
  `dev-bootstrap.ts`. `SERVER_FEATURES.skills` (added in task-001) is already advertised for free
  by `ws-server.ts`'s pre-existing `defaultFeatures()` (`Object.fromEntries(Object.values(
  SERVER_FEATURES).map(…))`) — no bootstrap.ts change was needed for the flag itself.
- `packages/server/src/daemon/bootstrap.test.ts` — added `{ type: "skills_list_request" }` to the
  production daemon's "registers the full RPC surface" probe list, and a new
  `describe("skills (sprint-075/task-004)", …)` block: production daemon answers
  `skills_list_request`; a dev daemon answers `unknown_message_type` for **both**
  `skills_list_request` and `skills_set_enabled_request` (mirrors the existing `provider_auth`
  block's structure/assertions).
- `packages/server/src/resources/resource-service.test.ts` (new) — isolated-`HOME` integration
  tests, real fs, `vi.waitFor`/short real-timer waits for the watcher (mirrors
  `file-watch-service.test.ts`'s own real-timer justification; a `sleep()` helper built on
  `Promise.withResolvers()` per house style).
- `packages/server/src/resources/skills-rpc.test.ts` (new) — RPC-level tests through a real
  `HandlerRegistry`/`routeTextFrame` (mirrors `viewer-settings-rpc.test.ts`'s
  `fakeSession`/`boot`/`dispatch` harness).
- `packages/server/AGENTS.md` — three updates: (1) three new entries in the `resources/`
  source-layout tree (`wire.ts`, `resource-service.ts`, `skills-rpc.ts`); (2) a new
  `### Pi resource management (`resources/`)` subsystem-reference section (tenets: Pi is the
  source of truth/no cache, never hand-edit `settings.json`, the amended re-enable-writes-`+…`
  toggle semantic, domain errors never `rpc_error`, broadcast-before-responding, the
  lazy-started daemon-lifetime watcher + own-write fold, production-only registration, sprint-076
  out-of-scope items), placed between "Extensions sync" and "Viewer settings" to match the
  `src/` tree's own ordering.
- `swe/architecture/pi-resource-management.md` § Toggle — added a note: Pi's own
  `togglePackageResource` always pushes a replacement `±pattern` entry on a real toggle and never
  collapses the filter array back to a bare string on that path; the pseudocode's "collapse" step
  is only reachable when clearing an override outright (`enabled === undefined`), which
  `skills_set_enabled_request` never sends — "collapse" is not used by the UI today.
- `swe/sprints/sprint-075-skills-list-toggle/in_progress/task-004-…md` (now `done/`) — amended
  acceptance criterion #2 per the assigned known-deviation instruction (see below).

## Files created/changed

| File | Change |
|---|---|
| `packages/server/src/resources/wire.ts` | New — `CatalogSkill`/`CatalogPackage` → `SkillInfo`/`PiPackageInfo` mapping |
| `packages/server/src/resources/resource-service.ts` | New — `ResourceService` (`list`/`setEnabled`, watcher, debounced external broadcast, own-write fold) |
| `packages/server/src/resources/skills-rpc.ts` | New — `registerSkillsHandlers` |
| `packages/server/src/resources/pi-sdk.ts` | Re-exports `PackageSource` (task-004's `setEnabled` needs it for `SettingsManager#getPackages`/`#setPackages` typing) |
| `packages/server/src/resources/resource-service.test.ts` | New — isolated-HOME integration tests |
| `packages/server/src/resources/skills-rpc.test.ts` | New — RPC-level tests |
| `packages/server/src/daemon/bootstrap.ts` | Wires `ResourceService` + `registerSkillsHandlers` (production only) |
| `packages/server/src/daemon/bootstrap.test.ts` | New `skills_list_request` probe + `describe("skills (sprint-075/task-004)", …)` block |
| `packages/server/AGENTS.md` | New `resources/` layout entries + new subsystem-reference section |
| `swe/architecture/pi-resource-management.md` | § Toggle note on the collapse-only-clears-an-override deviation |
| `swe/sprints/sprint-075-skills-list-toggle/in_progress/task-004-…md` → `done/` | Amended acceptance criterion #2; moved; status `done` |

`packages/server/src/daemon/dev-bootstrap.ts` — **untouched**, confirmed by its own
`unknown_message_type` test.

## How it satisfies the scope

Implements every item in "What to build": `ResourceService.list()`/`setEnabled()` over `wire.ts`;
the watcher (lazy start, four subscribed paths, 500 ms debounce, own-write fold);
`skills-rpc.ts`'s shape validation + domain-error posture; `SERVER_FEATURES.skills` advertisement
(already free via `ws-server.ts`'s `defaultFeatures()` since task-001 added the key);
production-only bootstrap registration; the `packages/server/AGENTS.md` subsystem section.

## Known deviation honoured (per assignment)

Task-002 found Pi's own `pi config` toggle (`ConfigSelectorComponent`/`ResourceList`) **always**
appends a replacement `+pattern`/`-pattern` entry — its collapse-to-bare-string branch is
unreachable on a real toggle. `toggle-patterns.ts` therefore also accepts `enabled === undefined`
meaning "clear without replacing" (not used by `setEnabled`, which only ever passes a concrete
`boolean`). Because the architecture doc's top rule is "writes exactly what `pi config` writes",
`setEnabled` is Pi-faithful: **re-enabling a package skill writes `+…`, exactly as `pi config`
does (entry stays object form; no collapse on enable)**. Amended:

- Task-004's acceptance criterion #2 in the task file (in `done/` now) — see the inline amendment
  note there.
- `swe/architecture/pi-resource-management.md` § Toggle — added the explanatory note described
  above.
- `resource-service.test.ts`'s `"ResourceService.setEnabled — package skill (amended acceptance
  #2)"` describe block asserts the entry stays object form with `+skills/gamma/SKILL.md` after
  re-enabling, never collapsing back to a bare string.

## Build & test results

```
$ npx tsc -b packages/server --force
(clean, no output)

$ npm run build:server
> tsc -b packages/server && chmod +x packages/server/dist/daemon/main.js
(clean, no output)

$ npx oxlint <8 touched/new .ts files>
(clean — zero warnings)

$ npx oxfmt <8 touched/new .ts files>
Finished in 99ms on 8 files using 32 threads.
(no diffs beyond the authored edits)

$ npx vitest run packages/server/src/resources
 Test Files  4 passed (4)
      Tests  36 passed (36)

$ npx vitest run packages/server/src/daemon/bootstrap.test.ts
 Test Files  1 passed (1)
      Tests  43 passed (43)

$ npx vitest run packages/server
 Test Files  74 passed (74)
      Tests  933 passed (933)
```

## Acceptance criteria

- [x] Toggling an agents_dir skill off writes `-skills/<name>/SKILL.md` to `settings.skills`; a
      fresh `resolve()` reports it disabled; on again replaces it with `+…` —
      `"ResourceService.setEnabled — top-level skill (acceptance #1)"` test (byte-exact
      `settings.json` assertions both ways; broadcast recorded twice, both `"mutation"`).
- [x] **(amended)** Toggling a package skill upgrades the entry to object form; re-enabling writes
      `+…`, exactly as `pi config` does (entry stays object form; no collapse on enable) —
      `"ResourceService.setEnabled — package skill (amended acceptance #2)"` test.
- [x] `skills_changed("mutation")` reaches every session before the response —
      `skills-rpc.test.ts`'s `'broadcasts skills_changed("mutation") to every active session,
      including the caller, before the response'` test (asserts `responseIdx > pushIdx` in the
      caller's own `sent` array, plus both caller and a bystander session receive the push).
- [x] An external write to the watched settings.json yields exactly one
      `skills_changed("external")` — `resource-service.test.ts`'s watcher describe block (plus a
      burst-collapses-to-one test, and the own-write-fold negative test).
- [x] Dev-bootstrap registry answers `unknown_message_type` for both RPCs —
      `bootstrap.test.ts`'s `"a dev daemon does not register skills_* …"` test, both
      `skills_list_request` and `skills_set_enabled_request`.

## Follow-ups/TODO(verify)

None for this task's scope. Preview/install/remove/update_all, the FIFO queue, and redaction are
explicitly deferred to sprint-076 per "Out of scope". Client/UI consumption is task-005/006
(already done, built independently against the protocol schemas this task now serves live).
