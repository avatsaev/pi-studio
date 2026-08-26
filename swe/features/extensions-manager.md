# Feature — Extensions Manager (Settings panel + Pi package management)

> Part of: [../MAIN-SCOPE.md](../MAIN-SCOPE.md)
> Dependencies: [preinstalled-extensions.md](preinstalled-extensions.md) (curated packs — the
> planner/executor/state machinery this feature renders and extends),
> [provider-auth-rpc.md](provider-auth-rpc.md) § web-client Settings (the `SettingsDialog`
> category registry + `ModelProvidersPanel` pattern this panel clones),
> `architecture/websocket-protocol` (append-only RPC conventions, flat snake_case naming)

## Purpose

Two gaps, one Settings surface:

1. **The curated-extensions subsystem is invisible in the browser.** Sprint-057 shipped the full
   stack — `extension_packs_list_request`/`extension_packs_set_request` in the daemon,
   `listExtensionPacks()`/`setExtensionPacks()`/`syncExtensionPacks()` on `PiStudioClient` — but
   the only consumer is the CLI (`pi-studio extensions list/select/sync`). A browser or
   relay-remote user cannot see whether the recommended extensions installed, why one failed, or
   trigger a retry. Install failures today surface only in daemon logs and the CLI table.
2. **No client can manage Pi packages at all.** Pi has a real package ecosystem
   ([pi.dev/packages](https://pi.dev/packages) — extensions, skills, prompts, themes via
   `pi install npm:…/git:…`), but installing or removing a package requires shell access on the
   daemon host. A remote client (browser over the relay, future mobile app) has no path to it —
   the same access asymmetry `provider_auth_*` (sprint-055) closed for credentials.

This feature adds an **Extensions** category to the existing `SettingsDialog`, delivered in two
phases with a hard boundary between them:

- **Phase A — render what exists.** A read+sync panel over the sprint-057 RPCs. Zero daemon/
  protocol/client changes; pure web-client work.
- **Phase B — manage packages.** A new `pi_packages_*` RPC family (list/install/remove over pi's
  global `settings.json` + spawned `pi install`/`pi remove`) and the panel's second section.

## Ground truth (verified against the repo, 2026-08-25)

These facts drive the design; do not re-derive them from memory:

- **The full Phase-A stack already exists.** Protocol schemas
  (`packages/protocol/src/messages.ts:908-1031`: `extensionEntryInfoSchema`,
  `extensionPackInfoSchema`, `extensionSyncReportSchema`, `extensionsLastSyncSummarySchema`, the
  list/set request/response pairs), the `extensionPacks` capability flag
  (`client-capabilities.ts`), daemon handlers (`extensions-rpc.ts` → `ExtensionsService`), and
  tested `PiStudioClient` facade methods (`pistudio-client.ts:506-535`). Web-client consumers:
  **zero** (grep-verified).
- **There is exactly ONE pack (`core`, 5 packages) and it cannot be deselected.**
  `CURATED_PACKS` (`curated-packs.ts:35-53`) contains only `core`; `swe`/`science`/`data` are a
  comment, not code. `ExtensionsService.setSelectedPacks` filters `core` out of the persisted list
  (`extensions-service.ts:76`) because `core` is always implicit. **A pack-toggle UI is therefore
  dead UI and is explicitly out of scope** until a second pack exists in the catalog.
- **`describe()` cannot see user-installed packages.** `planSync` (`sync-planner.ts`) looks up
  each *curated* identity in pi's `settings.json` via `findByIdentity`; it never enumerates
  settings entries absent from the catalog. `pi install npm:whatever` by hand is invisible to the
  existing RPC. Phase B's list needs a new read path — `readPiSettingsPackages(piHomeKey)` →
  `{ packages: unknown[]; ok: boolean }` (`extensions-state.ts:121`) already reads the raw array
  and is already exported for the CLI's `--local` path.
- **No config-write RPC exists.** `autoSync` is reported in the list response; nothing on the wire
  can change it (no `daemon_config_set` in `messages.ts`). It stays read-only display in this
  feature.
- **The install spawn seam is reusable as-is.** `sync-executor.ts`'s `InstallSpawn` interface +
  `defaultInstallSpawn` (argv `[process.execPath, <bundled pi cli>, "install", <source>]`,
  `PI_CODING_AGENT_DIR` env derived fresh from config, stderr capture, tree-kill on timeout,
  injectable fake for tests) is exactly what Phase B's install/remove needs — only the argv verb
  changes.
- **Sync/install is SLOW.** Per-package `pi install` runs `npm install` under the hood; the CLI
  passes `timeoutMs: 600_000` for `extensions select/sync`. UI must treat these as minutes-long
  operations.
- **`extension_packs_*` is production-bootstrap only.** `dev-bootstrap.ts` deliberately never
  registers the family; `npm run dev:daemon` answers `unknown_message_type`. All verification runs
  against `npm start`.
- **Removal does not fight the additive-only sync invariant.** The planner's `offered` map records
  *intent, not presence*, and `user_removed` is an existing terminal status: sync only installs an
  identity it has never successfully installed before, so a package removed by the user (CLI or
  Phase B UI) is never reinstalled. Phase B's remove is architecturally anticipated.
- **Pi loads packages at process start.** An install/remove affects already-running agent sessions
  only after respawn. The UI states this; it never offers to restart agents.
- **`pi remove <source>` / `pi list` exist** (pi 0.84.2 `docs/packages.md` § Install and Manage);
  `install`/`remove` write the **user** settings (`~/.pi/agent/settings.json` under the effective
  pi-home) unless `-l`. Phase B is global-scope only (see Edge cases).
- **Settings category registry contract** (`SettingsDialog.tsx`): a category is
  `{ id, label, icon, component (lazy), available(caps) }` in `SETTINGS_CATEGORIES`; capabilities
  are derived reactively from `useConnectionStore`'s `serverInfo.features` (the `providerAuth`
  precedent at line 73-75). `ModelProvidersPanel` (138 lines + 57 CSS) is the size/shape precedent
  for a panel.

## Public contract

### Phase A — no wire changes

Consumes existing RPCs only. Web-client additions:

| Surface | Addition |
|---------|----------|
| `SettingsCategoryCapabilities` | `extensionPacks: boolean` (from `serverInfo.features["extensionPacks"]`) |
| `SETTINGS_CATEGORIES` | `{ id: "extensions", label: "Extensions", icon: Puzzle, component: lazy(ExtensionsPanel), available: (caps) => caps.extensionPacks }` — after `providers` |
| New files | `features/extensions/ExtensionsPanel.tsx` + `.module.css`, `extensions-presentation.ts` (+ test) |

`extensions-presentation.ts` is the pure, jsdom-free module (precedent:
`provider-auth-presentation.ts`, `slash-commands.ts`): status → `{ label, tone }` mapping, sync
report → display lines (reusing the CLI's exact vocabulary from
`extensions-commands.ts#renderSyncReport`: `installed N of M recommended extensions`,
`✗ <source> (<pack>): <reason> — <first line of message>`), relative-time formatting for
`lastSync.at`.

Status → tone mapping (total over today's `EntryStatus`; unknown strings render as-is with the
neutral tone — the wire field is deliberately `z.string()`):

| Wire status | Label | Tone |
|-------------|-------|------|
| `installed` | Installed | positive |
| `pending` | Pending | neutral |
| `failed` | Failed | negative (row expandable → `reason`, `message`, `attempts`, `at`) |
| `user_removed` | Removed by you | neutral |
| `user_modified` | Modified by you | neutral |
| `deprecated` | Deprecated | muted |

### Phase B — new RPC family (flat snake_case, real `messages.ts` schemas, append-only)

| RPC | Request fields | Response fields |
|-----|----------------|-----------------|
| `pi_packages_list_request` | — | `{ ok, error?, packages: PiPackageInfo[] }` |
| `pi_packages_install_request` | `source: string` | `{ ok, error?, stderr?, packages: PiPackageInfo[] }` |
| `pi_packages_remove_request` | `source: string` | `{ ok, error?, stderr?, packages: PiPackageInfo[] }` |

```ts
// piPackageInfoSchema (.passthrough(), all optional beyond source — append-only rules)
{
  source: string;        // the settings.json entry's source string, verbatim
  kind: string;          // "npm" | "git" | "local" today (parseSource; plain string on the wire)
  identity: string;      // pi's dedup key: npm name / git URL sans ref / resolved path
  pinned?: boolean;      // parseSource.pinned — pinned specs are skipped by `pi update`
  curated?: boolean;     // identity ∈ CURATED_PACKS (cross-referenced via identityOf)
  filtered?: boolean;    // settings entry is object-form (per-package resource filters present)
}
```

Conventions (same as `extension_packs_*` / `provider_auth_*`):

- `ok`/`error` are **domain fields**, never `rpc_error` — expected failures (`invalid_source`,
  `install_failed`, `remove_failed`, `settings_unreadable`, `busy`, `spawn_failed`, `timeout`)
  return `{ ok: false, error }`; a thrown `rpc_error` means a bug.
- Every mutating response carries the **post-operation** `packages` list (re-read from disk after
  the spawn completes), so the client never renders a stale or optimistic list — the
  `extension_packs_set_response`-recomputes-`describe()` precedent.
- Registered via explicit `HandlerRegistry.register()` in **`bootstrap.ts` only** (dev daemon
  answers `unknown_message_type`, matching `extension_packs_*`).
- New server feature flag: `piPackages` (precedent: `extensionPacks`), gating the panel's
  Installed-packages section independently of Phase A's curated section.

| Surface | Addition |
|---------|----------|
| Client SDK | `PiStudioClient.listPiPackages()`, `installPiPackage(source, {timeoutMs})`, `removePiPackage(source, {timeoutMs})` |
| Server | `extensions/packages-service.ts` (`PiPackagesService`), `extensions/packages-rpc.ts` (`registerPiPackagesHandlers`) |
| Protocol | 6 schemas + `piPackages` flag |

### New/changed files

| File | Phase | Responsibility |
|------|-------|----------------|
| `packages/web-client/src/features/extensions/ExtensionsPanel.tsx` | A (+B section) | Panel: curated status list, sync action, (B) installed packages + install/remove |
| `packages/web-client/src/features/extensions/ExtensionsPanel.module.css` | A | Styles (clone `ModelProvidersPanel.module.css` vocabulary) |
| `packages/web-client/src/features/extensions/extensions-presentation.ts` (+`.test.ts`) | A | Pure status/report/time presentation logic |
| `packages/web-client/src/features/settings/SettingsDialog.tsx` | A | `extensionPacks` (+B `piPackages`) capability, category entry |
| `packages/protocol/src/messages.ts` | B | `pi_packages_*` schemas |
| `packages/protocol/src/client-capabilities.ts` | B | `piPackages` flag |
| `packages/server/src/extensions/packages-service.ts` (+test) | B | list (settings read + classify) / install / remove orchestration, mutex |
| `packages/server/src/extensions/packages-rpc.ts` (+test) | B | Thin handler registration, shape validation of `source` |
| `packages/server/src/daemon/bootstrap.ts` | B | `registerPiPackagesHandlers(...)` |
| `packages/client/src/pistudio-client.ts` (+test) | B | Three facade methods |
| `packages/client/src/test-support/scripted-daemon.ts` | B | Scripted `pi_packages_*` cases |

## Behavior & algorithms

### Phase A — panel data flow

```
mount:
    query ["extensions","packs"] → client.listExtensionPacks()
    (TanStack useQuery, default options — the use-provider-models.ts convention;
     enabled only while connected && caps.extensionPacks)

render:
    header: autoSync badge (read-only: "Auto-sync on/off"),
            lastSync? → "Last sync: <relative time> — <outcome>"
    per pack (today: only core):
        pack title + description
        per entry row: source · status badge · addedIn
                       failed ⇒ expandable lastError {reason, message, attempts, at}
    footer: [Sync now]

sync now:
    setInFlight; client.syncExtensionPacks({ timeoutMs: 600_000 })   # CLI parity
    → render response.report lines via extensions-presentation
    → setQueryData(["extensions","packs"], response fields)          # set response IS the fresh list
    errors (rpc_error/timeout) → inline error line, button re-enabled; never a thrown crash
```

The in-flight state must survive minutes (button disabled + spinner + "this can take several
minutes" hint) — no optimistic completion, no 30 s default timeout.

### Phase B — service

```
PiPackagesService(deps: { home, config, spawn?: InstallSpawn, logger }):
    mutex = createLimiter(1)          # same in-process serialization as ExtensionsService.sync
                                      # NOTE: a separate mutex from ExtensionsService's — see
                                      # Edge cases for the concurrent-sync interaction

list():
    piHomeKey = effectivePiHomeKey(config)                 # THE shared derivation, never a path join
    { packages, ok } = readPiSettingsPackages(piHomeKey)
    if !ok: return { ok: false, error: "settings_unreadable", packages: [] }
    curatedIdentities = set(identityOf(e.source) for e in all CURATED_PACKS entries)
    return { ok: true, packages: [ classify(entry) for entry in packages ] }

classify(entry):                       # entry is string | { source, ...filters } | unknown
    sourceString = packageSourceString(entry)              # reuse sync-planner helper
    if !sourceString: skip entry (tolerate unknown shapes — settings is pi's file, not ours)
    parsed = parseSource(sourceString)                     # kind/identity/pinned; local paths ⇒ kind "local", identity = source
    return { source: sourceString, kind, identity, pinned,
             curated: identity ∈ curatedIdentities,
             filtered: entry is object-form }

install(source) / remove(source):
    validate source: non-empty string; must parse via parseSource OR be a path form
        (starts "/" or "./" or "~"); else { ok: false, error: "invalid_source" }
    under mutex:
        cli = resolveBundledPiCli(); null ⇒ { ok: false, error: "spawn_failed" }
        env = same PI_CODING_AGENT_DIR derivation as sync-executor (fresh from config)
        result = spawn({ command: [process.execPath, cli, VERB, source],
                         env, timeoutMs: 600_000 })        # VERB = "install" | "remove"
        ok = result.exitCode === 0 && !result.timedOut
        listResult = list()                                # ALWAYS re-read, success or not —
        return { ok, error?: classify-style reason,        # a failed install may still have
                 stderr?: bounded first lines,             # mutated settings.json
                 ...listResult }
```

**What Phase B never does:** touch `extensions-state.json` (that file is the curated planner's
bookkeeping; a user-initiated install/remove is exactly the "user reality" the planner reads from
`settings.json` on its next run and classifies as `user_removed`/pre-existing), write
`settings.json` directly (all mutations go through `pi install`/`pi remove`, same tenet as the
curated executor), or spawn anything on the list path.

### Phase B — panel section

```
"Installed packages" (visible when caps.piPackages):
    query ["extensions","packages"] → client.listPiPackages()
    per row: source · kind badge · [curated] badge when curated · [pinned] when pinned
             · [filtered] when filtered · Remove action (hidden for curated rows — removing a
             curated entry is supported by sync semantics but belongs in the CLI/pi config;
             the UI keeps one obvious story: curated = managed by Pi-Studio)
    "Install package…": text input accepting npm:<name>[@ver] | git:<url>[@ref] |
             https://… | absolute/relative path
        → confirm dialog quoting the EXACT source string + the security warning
          ("Pi packages run with full system access; extensions execute arbitrary code.
            Review the source before installing." — pi's own docs.packages wording)
        → installPiPackage(source, { timeoutMs: 600_000 }); in-flight state as Phase A
        → response.packages replaces the query data; stderr shown on failure (bounded)
    Remove → same confirm/in-flight/replace cycle via removePiPackage
    footnote (static): "Changes apply to newly started agent sessions."
```

## Data & persistence touchpoints

- **Reads** pi's `settings.json` under the effective pi-home (Phase B list) — via the existing
  `readPiSettingsPackages`; tolerant of absent file (⇒ empty list, `ok: true`).
- **Mutates** pi's `settings.json` only indirectly via spawned `pi install` / `pi remove`.
- **Never touches** `extensions-state.json`, `config.json`, or any Pi-Studio entity file. No new
  persisted state anywhere; no migrations. All new wire schemas `.passthrough()` + optional fields.

## Error handling & edge cases

| Condition | Expected behavior |
|-----------|-------------------|
| Daemon lacks `extensionPacks` flag (old daemon, dev daemon) | Category absent from Settings sidebar entirely (`available` gate) — never an erroring panel |
| Daemon has `extensionPacks` but not `piPackages` (Phase A daemon + Phase B client) | Curated section renders; Installed-packages section absent |
| Sync/install/remove in flight | Buttons disabled, spinner, "may take several minutes"; explicit `timeoutMs: 600_000` on the request |
| Sync returns `partial`/`failed` | Report lines rendered per failure (CLI vocabulary); list refreshed from the set-response fields; no toast spam |
| `pi install` fails but wrote settings anyway | Post-op re-read is unconditional — list reflects disk truth, `ok: false` + stderr explain the failure |
| Remove of a curated, previously-offered package (via CLI — UI hides the action) | Next `describe()` shows `user_removed`; sync never reinstalls (`offered` = intent, not presence) |
| Unknown entry shape in `settings.json` (future pi forms) | Skipped by `classify`, never a crash; remaining entries still listed |
| Unknown `status`/`kind` string from a newer daemon | Rendered verbatim with neutral tone (wire fields are `z.string()` by design) |
| Concurrent curated sync and package install | Separate mutexes ⇒ two `pi` processes may run concurrently; safe — pi's own CLI serializes settings writes per invocation and both operations are single-spec; worst case is npm doing parallel work. Do NOT share ExtensionsService's mutex (a 10-minute sync would block an unrelated remove) |
| `source` with shell metacharacters | Irrelevant by construction — spawn uses argv array, never a shell string; still validated via `parseSource` to fail fast with `invalid_source` |
| Project-scope installs (`pi install -l`) | **Out of scope.** The daemon has no single project cwd; global (effective pi-home) only. Revisit if per-workspace extension config becomes a scope |
| `autoSync` toggle from the browser | **Out of scope** (no config-write RPC exists). Read-only badge |
| Pack selection toggles | **Out of scope** while the catalog has only `core` (dead UI; `setSelectedPacks` filters `core` regardless) |
| Relay transport | Nothing transport-specific — same session RPCs; must work unchanged over the relay like `provider_auth_*` did (verify once, no special code) |

## Dependencies on other specs

- `preinstalled-extensions.md` — defines the planner/executor/state semantics Phase A renders and
  the additive-only invariant Phase B's remove coexists with; `wire.ts`/status vocabulary; the
  `InstallSpawn` seam.
- `provider-auth-rpc.md` (+ sprint-065 web-client work) — the Settings category registry,
  capability gating, panel layout, and stacked-dialog conventions this feature clones.
- `architecture/websocket-protocol.md` — append-only schema rules, flat snake_case naming,
  domain-`ok`/`error` vs `rpc_error` convention.

## Acceptance criteria

Phase A:

- [ ] Against `npm start` (production daemon), Settings shows an **Extensions** category; against
      `npm run dev:daemon` (no `extensionPacks` flag) the category is absent and nothing errors.
- [ ] The panel lists every `core` entry with source, status badge, and `addedIn`; a `failed`
      entry expands to reason/message/attempts; `lastSync` and `autoSync` render in the header.
- [ ] **Sync now** completes a real sync (round-tripped through a real `pi install` when at least
      one entry is `pending`/`failed`), renders the report in CLI-identical vocabulary, and the
      list reflects post-sync state without a page reload.
- [ ] A sync that takes > 30 s neither times out nor re-enables the button early.
- [ ] `extensions-presentation.test.ts` covers the total status map (build-time exhaustiveness
      over `EntryStatus` like `wire.ts`'s), report rendering parity with `renderSyncReport`'s
      cases, and unknown-status passthrough.

Phase B:

- [ ] `pi_packages_list_request` returns every entry of the effective pi-home's `settings.json`
      `packages` array with correct `kind`/`identity`/`curated`/`pinned`/`filtered`, and
      `{ ok: false, error: "settings_unreadable" }` (not a crash) for corrupt JSON.
- [ ] Installing `npm:pi-web-access` (or any small real package) from the browser succeeds
      against a real daemon: confirm dialog shown first, in-flight state until completion,
      post-install list contains the entry, and a subsequently spawned agent session loads the
      extension.
- [ ] Removing that package from the browser removes it from `settings.json` and the list; the
      next curated sync does **not** reinstall a curated identity removed this way (verified via
      `describe()` → `user_removed`).
- [ ] A failed install (nonexistent package name) returns `{ ok: false }` with bounded stderr,
      renders inline, and leaves the list matching disk.
- [ ] Dev daemon answers `unknown_message_type` for all three RPCs; the panel's packages section
      is absent when `piPackages` is unadvertised.
- [ ] Full gates: `npm run build`, `npm run typecheck`, `npm test`, scoped `oxfmt` on changed
      files.
- [ ] Docs updated in the same change: `packages/web-client/AGENTS.md` (new feature section +
      invariants), `packages/server/AGENTS.md` (packages-service/rpc rows + invariants),
      `packages/protocol/AGENTS.md` (schema family), `packages/client/AGENTS.md` (facade methods),
      root `AGENTS.md` § Protocol overview (one bullet), this spec's index row in `MAIN-SCOPE.md`.

## TODO(verify) — resolve while implementing

- [ ] `pi remove <source>` exit-code semantics for a source **not present** in settings (error or
      no-op success?) — determines whether remove-of-missing maps to `ok: true` (idempotent) or
      `remove_failed`. Verify against the bundled pi 0.84.x before wiring the error taxonomy.
- [ ] Whether `pi remove` accepts the exact same source-string forms as `install` (npm shorthand
      without `npm:`? path forms?) — constrains `invalid_source` validation strictness.
- [ ] `parseSource` behavior on local-path sources (it targets npm/git specs today) — Phase B's
      `classify` may need a small path-form branch before calling it; confirm rather than assume.
