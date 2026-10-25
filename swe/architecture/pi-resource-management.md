# Pi Resource Management — Clean Room Scope

> Part of: [MAIN-SCOPE.md](../MAIN-SCOPE.md)
> Related scopes: [features/skills-manager.md](../features/skills-manager.md) (the consumer),
> [features/extensions-manager.md](../features/extensions-manager.md) (Phase B superseded),
> [features/preinstalled-extensions.md](../features/preinstalled-extensions.md) (curated planner
> sharing `settings.json`), [websocket-protocol.md](websocket-protocol.md)
> Source brief: [grills/skills-manager.md](../grills/skills-manager.md) (decisions cited as `Dnn`;
> the brief's § Post-scope review records the simplifications applied here as R1–R8)

## Purpose

One daemon-side backend that reads and mutates the resources Pi loads — skills and the Pi packages
that carry them — for **remote clients without a shell on the daemon host**. It replaces
extensions-manager Phase B (`pi_packages_*`): the daemon has exactly one mutator over Pi's
`settings.json` `packages` array (D1), exposed through the single `skills_*` family (R1).

Tenets:

1. **Pi is the source of truth.** No Pi-Studio resource state (D13), no cache (R6). Lists come
   from Pi's resolver on every request; toggles write Pi's filter syntax. A plain `pi config` on
   the host sees exactly what the panel shows.
2. **Never hand-edit `settings.json`; mutate only through Pi's own code** — in-process
   `SettingsManager`, or a spawned bundled `pi` CLI (D10).
3. **Agent Skills repos go through the pinned `skills` CLI** so `~/.agents/.skill-lock.json` stays
   consistent with the user's own `npx skills` (D18).
4. **Disk truth after every mutation**: every mutating response carries the re-resolved list.
5. **Nothing speculative.** No preview state, no second RPC family, no upload pipeline, no
   update-checker (R2–R5, R7). Each can be added later without reshaping what is here.

## Ground truth (verified 2026-10-25 against Pi 1.4.0, `skills` 1.7.4, and this repo)

Pi SDK (`node_modules/@earendil-works/pi-coding-agent`, public exports of `dist/index.d.ts`):

- `DefaultPackageManager.resolve(onMissing?)` → `ResolvedPaths.skills: {path, enabled,
  metadata:{source, scope, origin:"package"|"top-level", baseDir?, packageRoot?}}[]`. With
  `onMissing → "skip"` and sources on disk: **no network** (`package-manager.js:1000-1057`).
  Colliding names are listed as separate entries.
- `metadata.baseDir` per origin: `<agentDir>` for `<agentDir>/skills/*`; `~/.agents` for
  `~/.agents/skills/*` (resolved from `$HOME`, **not** pi-home); the install dir (= `packageRoot`)
  for package skills (`package-manager.js:1986-2068, 1038-1055`).
- **Toggle pattern derivation is private** (`modes/interactive/components/config-selector.js:655-717`).
  Verified by experiment on an isolated `HOME`: top-level → `relative(baseDir ?? agentDir, path)`
  written as `±<pattern>` into `settings.skills`; package → `relative(baseDir, path)` into
  `packages[i].skills` (string entry upgraded to `{source}`; collapses back when no filter arrays
  remain). An existing entry with the same stripped pattern is replaced. `-skills/beta/SKILL.md`
  flipped `~/.agents/skills/beta` to `enabled:false`.
- Consequence: `<agentDir>/skills/x` and `~/.agents/skills/x` yield the **same** pattern; one
  filter toggles both. Pi behaviour, kept.
- `SettingsManager.create(cwd, agentDir)` loads once; setters enqueue an async locked write
  (`proper-lockfile`); `await flush()` guarantees disk; `await reload()` is the only refresh.
- Filter semantics: `extensions: []` loads none of a package's extensions; absent = all.
- `pi install <source>` writes a bare source string via `addSourceToSettings`
  (`package-manager.js:624-656`); on an existing same-identity entry it rewrites only `source`.
  npm installs run lifecycle scripts. Install roots `<agentDir>/npm`, `<agentDir>/git`.
- CLI verbs: `pi install <source>`, `pi remove <source>`, `pi update --extensions` (all packages).
- Skills loader `loadSkillsFromDir(root)` (public): name = frontmatter `name` ‖ parent dir; name/
  description rules produce `warning` diagnostics (skill still loads); same-name conflicts produce
  `{type:"collision", collision:{name, winnerPath, loserPath}}`.

`skills` CLI 1.7.4 (MIT; `engines.node >=22.20.0`; bin `bin/cli.mjs`; deps `tar`, `yaml`; no
`exports`/`main` — spawn only):

- Agent `pi` is "universal": `add <src> -g -a pi -y -s <names…>` (source **before** `-s`: it is variadic and swallows a trailing source — verified live) writes a real directory at
  `~/.agents/skills/<sanitized-name>/` and a v3 lock entry (`~/.agents/.skill-lock.json`, or
  `$XDG_STATE_HOME/skills/.skill-lock.json`). Existing names are **silently overwritten**.
- `remove -g -y <name>` **without `-a`** deletes the canonical copy, unlinks other agents' symlinks
  (never follows them), drops the lock entry. With `-a pi` it keeps the copy if any other detected
  agent links it — so `-a` is never passed to `remove`.
- `update -g -y` reinstalls every outdated global skill; idempotent; exit 1 only on failures.
  `check` is an alias of `update` (mutates). No machine-readable output anywhere.
- Forces `GIT_TERMINAL_PROMPT=0` and `ssh -o BatchMode=yes`; `DISABLE_TELEMETRY=1`/`DO_NOT_TRACK=1`
  disable telemetry; `SKILLS_CLONE_TIMEOUT_MS` (default 300 000).

Repo:

- `extensions/sync-executor.ts` — `InstallSpawn` seam (`{command, env, timeoutMs} →
  {exitCode, stderr, timedOut?}`), tree-kill on timeout; caller truncates stderr to 2 048.
  `resolveBundledPiCli()` in `agent/providers/pi/rpc-transport.ts`. `effectivePiHomeKey(config)`
  in `extensions-state.ts` is the one agentDir derivation.
- `curated-packs.ts` `parseSource`/`identityOf` accept only `npm:`/`git:`.
- `util/concurrency.ts` `createLimiter(1)` — the mutex pattern.
- `files/file-watch-service.ts` — `subscribe(rawPath, listener)`, any host path, 150 ms coalescing.
- `viewers/viewer-settings-rpc.ts` — `broadcast(getActiveSessions(), msg)` before responding.

## Public contract

### Components (`packages/server/src/resources/`, new)

| Module | Responsibility |
|--------|----------------|
| `pi-sdk.ts` | The **only** importer of Pi's `SettingsManager`, `DefaultPackageManager`, `loadSkillsFromDir`. Constructs them per operation for `agentDir`; `reload()`s before every read. |
| `toggle-patterns.ts` | Mirror of Pi's private pattern derivation + filter-array update. Pure. Listed in root `AGENTS.md`'s Pi-bump checklist beside `thinking-levels.ts`. |
| `skill-catalog.ts` | Builds the list from `resolve()`, frontmatter, collision diagnostics, lock file. Pure over injected readers. |
| `source-detect.ts` | Lives in `packages/protocol` (shared with the client); pure classifier. |
| `skills-cli.ts` | Resolves the pinned `skills` bin from its own `package.json` `bin`; builds argv/env. |
| `resource-service.ts` | `ResourceService`: FIFO queue, every operation, watcher, `skills_changed`. |
| `skills-rpc.ts` | Handler registration + shape validation. |
| `wire.ts` | Service types → protocol wire types. |

### Source kinds

| Input | `kind` | Engine |
|-------|--------|--------|
| `npm:<name>[@<version>]` | `pi_npm` | spawned `pi install` + skills-only filter write |
| `git:<url>[@<ref>]` | `pi_git` | same |
| `owner/repo`, `owner/repo@skill`, GitHub/GitLab URLs (incl. `/tree/<ref>/<path>`), `git@host:…`, `ssh://…`, `*.git` | `skills_repo` | preview (shallow clone + Pi loader), then `skills add` |
| Absolute or `~`-prefixed path to an existing directory on the daemon host | `local_path` | `settings.skills` entry, no copy |
| Anything else | — | `invalid_source` |

The server runs detection authoritatively; a client-sent `kind` is ignored.

### Wire family `skills_*` (feature flag `skills`)

Flat snake_case, real `messages.ts` schemas, `.passthrough()`, optional fields beyond those listed.
Expected failures are **domain** `{ok:false, error, message?}`, never `rpc_error`. Registered in
`daemon/bootstrap.ts` only; dev daemon answers `unknown_message_type` (D17).

| RPC | Request | Response |
|-----|---------|----------|
| `skills_list_request` | — | `{ok, error?, skills: SkillInfo[], packages: PiPackageInfo[]}` |
| `skills_preview_request` | `source` | `{ok, error?, kind, source, skills: PreviewSkill[]}` — `skills_repo` and `local_path` only; package kinds answer `{ok:true, kind, skills: []}` (nothing to pick) |
| `skills_install_request` | `source`, `skills?: string[]` (picked names, `skills_repo` only), `replace?: boolean` | `{ok, error?, results: ItemResult[], skills, packages}` |
| `skills_set_enabled_request` | `path`, `enabled` | `{ok, error?, skills, packages}` |
| `skills_remove_request` | `path` \| `packageSource` | `{ok, error?, stderr?, skills, packages}` |
| `skills_update_all_request` | — | `{ok, error?, results: ItemResult[], skills, packages}` (one result per engine) |
| `skills_changed` (push, every session) | — | `{type:"skills_changed", reason:"mutation"\|"external"}` |

```
SkillInfo      { name, description?, path, enabled, origin, originLabel, packageSource?,
                 shadowedBy?: path, symlinkTarget?, provenance?: {source, sourceUrl?, installedAt?},
                 disableModelInvocation?, warnings?: string[], removable: boolean }
  origin ∈ "agent_dir" | "agents_dir" | "package" | "settings_path"   (plain string on the wire)
PiPackageInfo  { source, kind:"npm"|"git"|"local", identity, pinned, curated, filtered, skillCount }
PreviewSkill   { name, description?, relPath, warnings?: string[], valid: boolean, exists: boolean }
ItemResult     { target, ok, error?, stderr? }
```

Errors: `invalid_source`, `settings_unreadable`, `preview_failed`, `no_valid_skills`,
`name_exists`, `not_removable`, `not_found`, `spawn_failed`, `timeout`, `install_failed`,
`remove_failed`, `update_failed`. Clients render unknown strings verbatim.

### Timeouts

| Operation | Daemon bound | SDK `timeoutMs` |
|-----------|--------------|-----------------|
| list, set_enabled | — | default |
| preview | 120 s | 150 s |
| install, remove, update_all | 600 s per spawn | 660 s (update_all: 1 300 s) |

## Behavior & algorithms

```
ctx():
    agentDir       = effectivePiHomeKey(config)
    agentsSkillsDir= $HOME/.agents/skills
    lockPath       = $XDG_STATE_HOME/skills/.skill-lock.json if set else $HOME/.agents/.skill-lock.json
```

### List (per request, no cache — R6)

```
list():
    settings = readJson(agentDir/settings.json); corrupt ⇒ {ok:false, error:"settings_unreadable"}
    sm = SettingsManager.create($HOME, agentDir); await sm.reload()
    resolved = pm.resolve(onMissing → "skip").skills filtered to scope == "user"
    lock = readLock(lockPath) (absent/unparseable ⇒ {})
    rows = for r in resolved:
        fm = frontmatter(r.path) → name, description, disable-model-invocation, warnings
        origin = package | agents_dir | agent_dir | settings_path   (by r.metadata.origin / path prefix)
        symlinkTarget = realpath(dir) when dir is a symlink
        provenance = lock[name] when origin == agents_dir
        removable = origin != package                                   (D9)
    shadowing: loadSkillsFromDir over ENABLED paths in resolve order; each collision sets
               loser.shadowedBy = winnerPath                            (D19)
    packages = settings.packages classified (own npm:/git:/path parser; curated via CURATED_PACKS
               identities; filtered = object form; skillCount from resolved)
```

### Toggle (immediate, outside the queue — D21)

```
setEnabled(path, enabled):
    row = list row for path; absent ⇒ not_found
    package: entry = packages[i]; pattern = relative(row.baseDir, path);
             entry.skills = replacePattern(entry.skills, pattern, enabled); collapse; sm.setPackages
    else:    pattern = relative(row.baseDir ?? agentDir, path);
             sm.setSkillPaths(replacePattern(settings.skills, pattern, enabled))
    await sm.flush(); broadcast skills_changed("mutation"); return list()
replacePattern(arr, pattern, enabled): drop entries whose stripped form == pattern; append ("+"|"-")+pattern
```

> Note (sprint-075/task-002, confirmed by task-004's implementation): Pi's own
> `togglePackageResource` always pushes a replacement `±pattern` entry on a real toggle and never
> collapses the filter array back to a bare string on that path — the `collapse` step above is
> only reachable when clearing an override outright (`enabled === undefined`), which the
> `skills_set_enabled_request` UI never sends. `setEnabled` therefore writes `+…`/`-…` on both
> enable and disable, package entries included; "collapse" is not used by the UI today.

### Preview (stateless — R2; `skills_repo` / `local_path` only — R3)

```
preview(source):
    kind = detect(source)
    pi_npm | pi_git: return {kind, skills: []}            # packages are installed as a unit
    local_path:  root = source
    skills_repo: scratch = mkdtemp($PI_STUDIO_HOME/tmp/preview-);
                 git clone --depth 1 [--branch ref] <url> scratch (120 s, prompts disabled);
                 root = scratch/<subpath from /tree/<ref>/<path>> if any
    skills = loadSkillsFromDir(root) → {name, description, relPath, warnings, valid: has name+description,
             exists: agentsSkillsDir/<sanitize(name)> exists}
    rm scratch; none valid ⇒ no_valid_skills; return
```

### Install (queued)

```
install(source, picked?, replace?):
    pi_npm | pi_git:
        spawn pi install <source>                                     (InstallSpawn, 600 s, killable)
        exit != 0 ⇒ ItemResult install_failed (+stderr); still re-list (settings may have changed)
        else: sm.reload(); entry = packages[identity]; upgrade to object form;
              entry.extensions = entry.prompts = entry.themes = []     # skills-only (R3)
              sm.setPackages(…); await sm.flush()
        # Unfiltered window = one locked file write between the two steps. Accepted (R8).
    skills_repo:
        picked required; names where exists && !replace ⇒ name_exists results, excluded
        spawn skills add <url> -g -a pi -y -s <picked…>   (source first in real argv)              (600 s)
        per name: ok iff agentsSkillsDir/<sanitized>/SKILL.md exists afterwards
    local_path: sm.setSkillPaths([...skills, "+" + absPath]); flush    # nothing copied
    broadcast; return {results, ...list()}
```

### Remove (D20)

```
remove({path}):
    row = list row; package ⇒ not_removable
    settings_path: drop the entry (any ± form) from settings.skills; files untouched
    dir is symlink: unlink the link only
    agents_dir with lock entry: spawn skills remove -g -y <name>      (no -a: host-wide)
    plain dir under agent_dir/agents_dir: rm -r; realpath must stay inside the origin root
    drop any ±pattern for this path from settings.skills
remove({packageSource}): spawn pi remove <source>
```

### Update all (R5)

```
updateAll():
    results = [ spawn skills update -g -y        → ItemResult target:"agent-skills",
                spawn pi update --extensions     → ItemResult target:"pi-packages" ]   (600 s each)
    broadcast; return {results, ...list()}
```

Pinned packages are skipped by Pi itself; object-form filters are preserved by Pi.

### Queue, watcher, broadcast (D21, D27)

- One `createLimiter(1)` FIFO for preview, install, remove, update_all — separate from
  `ExtensionsService`'s sync mutex. `set_enabled` and `list` bypass it.
- Watched (via `FileWatchService.subscribe`): `<agentDir>/settings.json`, `<agentDir>/skills`,
  `~/.agents/skills`, the lock file. Event → 500 ms debounce → broadcast
  `skills_changed("external")`. Events during a queued mutation fold into its own broadcast.
- Mutations broadcast `skills_changed("mutation")` **before** responding.
- Watchers start on the first `skills_*` RPC and live for the daemon's lifetime.

### Spawn environment

Argv arrays, never a shell string. `PI_CODING_AGENT_DIR` from `effectivePiHomeKey`,
`GIT_TERMINAL_PROMPT=0`, `GIT_SSH_COMMAND` default `ssh -o BatchMode=yes`, `npm_config_yes=true`,
`DISABLE_TELEMETRY=1`, `DO_NOT_TRACK=1`, `SKILLS_CLONE_TIMEOUT_MS` below the item timeout.
stderr tail ≤ 2 048 bytes.

### Redaction & logging (D29)

`redactSource`: strip `user[:password]@` from URL-like substrings and mask `token`/`access_token`
query values. Applied to logs, stderr tails, and every wire `source`/`sourceUrl`. Info log per
mutation `{op, kind, source, outcome, durationMs}`; warn on failure with the redacted tail.
`wire.ts` redacts `PiPackageInfo.source`/`identity`, `SkillInfo.packageSource` and provenance, so a
client only ever holds redacted strings; `skills_remove`'s `packageSource` is matched on its
redacted form and the spawn receives the real settings entry (sprint-076 live finding).
`pi remove <source>` is spawned with `cwd = agentDir`: Pi resolves a local-path source against its
cwd, while settings entries are relative to the agentDir (otherwise "No matching package").

## Data & persistence touchpoints

No new Pi-Studio state (D13).

| Path | Read | Write |
|------|------|-------|
| `<agentDir>/settings.json` | list | toggles, skills-only package filters, local-path entries (in-process); package add/remove (spawned `pi`) |
| `<agentDir>/skills/*` | list | remove only |
| `<agentDir>/npm`, `<agentDir>/git` | — | Pi-owned |
| `~/.agents/skills/*`, lock file | list | `skills` CLI only (install/remove/update) |
| `$PI_STUDIO_HOME/tmp/preview-*` | — | scratch, deleted in the same request |

## Error handling & edge cases

| Condition | Expected behavior |
|-----------|-------------------|
| Corrupt `settings.json` | `settings_unreadable` on list and every mutation; file never rewritten |
| Same name in `<agentDir>/skills` and `~/.agents/skills` | Both listed, loser `shadowedBy`; one shared filter pattern toggles both (Pi semantics; panel tooltip) |
| Toggle on a curated package skill | Allowed; entry becomes object form ⇒ curated planner reports `user_modified` (D24); `pi update --extensions` unaffected |
| `pi install` succeeds, filter write fails | ItemResult failed; entry stays unfiltered on disk — surfaced as `filtered: false` on the package row; no rollback (D25) |
| Agent spawned during the install→filter-write window | May load the package's extensions once; accepted (R8), documented |
| `skills add` installs 2 of 3 picked | Per-name results from post-spawn existence check |
| Picked name exists, no `replace` | `name_exists` per item; client offers Replace and resubmits |
| Remove realpath escapes its origin root | `not_removable`; nothing deleted |
| Timeout | tree-kill, `timeout`, re-list |
| Pre-v3 lock file | Rows without provenance; CLI rewrites it on its next write |
| `pi update --extensions` partially fails | `update_failed` result with stderr tail; the other engine's result independent |
| Daemon without `skills` flag | Category hidden; client never calls |

## Dependencies on other specs

- `features/skills-manager.md` — the UI this serves.
- `features/extensions-manager.md` — Phase B superseded; Phase A unchanged.
- `features/preinstalled-extensions.md` — curated identities, `user_modified`, `InstallSpawn`.
- `websocket-protocol.md` — append-only schemas, flat naming, domain `ok`/`error`.

## Acceptance criteria

- [ ] `toggle-patterns.ts` tests: agentDir, `~/.agents`, and package patterns match Pi's
      `config-selector.js` for the same inputs; string→object upgrade and collapse; same-pattern
      entry replaced, not duplicated.
- [ ] Isolated-`HOME` integration test: disabling flips `resolve()`'s `enabled`; a fresh
      `SettingsManager` reads the same file.
- [ ] Installing `npm:` package X leaves `settings.json` with `{source, extensions:[], prompts:[],
      themes:[]}`; a new agent lists X's skills in `get_commands` and loads none of its extensions.
- [ ] `source-detect` covers every row of the source-kind table.
- [ ] Preview leaves no scratch dir behind, success or failure.
- [ ] Remove never follows a symlink; refuses realpaths outside the origin root; `skills remove`
      is spawned without `-a`.
- [ ] Mutations serialize FIFO; `set_enabled` during a running install completes immediately.
- [ ] External edit to `settings.json` → one debounced `skills_changed("external")`.
- [ ] `git:https://user:tok@host/r` never appears unredacted in logs or responses.
- [ ] Dev daemon answers `unknown_message_type` for every `skills_*` RPC.

## TODO(verify)

- [ ] `pi install` on an existing same-identity object-form entry keeps the filter arrays
      (`addSourceToSettings` rewrites only `source`) — matters for re-installing a package already
      managed skills-only. Verify before wiring; if not, re-apply the filters after the spawn.
