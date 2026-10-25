# Task 003 — `pi-sdk.ts` + `skill-catalog.ts`: build the skill list from Pi's resolver

- **Sprint:** sprint-075-skills-list-toggle
- **Completed:** 2026-10-25
- **Status:** done

## What was implemented

- `packages/server/src/resources/pi-sdk.ts` — the single importer of Pi's `SettingsManager`,
  `DefaultPackageManager`, and `loadSkillsFromDir` from `@earendil-works/pi-coding-agent`.
  `openPiResources(agentDir, cwd)` constructs a fresh `SettingsManager` (reloaded from disk) and a
  `DefaultPackageManager` bound to it, every call — no caching across operations, per the
  architecture doc's tenet. `loadSkillsFromDir` and its `LoadSkillsResult` type are re-exported so
  `skill-catalog.ts` never imports the Pi package directly.
- `packages/server/src/resources/skill-catalog.ts` — `buildCatalog({agentDir, home, lockPath})`:
  - Corrupt `<agentDir>/settings.json` ⇒ `{ok:false, error:"settings_unreadable"}`, checked by a
    direct `JSON.parse` of the raw file **before** `SettingsManager` ever touches it (a missing
    file is fine — Pi's own forgiving error-swallowing in `SettingsManager.reload()` would hide a
    real corruption, so this check happens independently, exactly the `readPiSettingsPackages`
    precedent in `extensions-state.ts`).
  - Calls `packages.resolve(onMissing → "skip")`, filters to `metadata.scope === "user"` (project
    skills are deferred, R7).
  - Reads the v3 lock file (`{version:3, skills:{name:{source, sourceUrl, installedAt, …}}}`,
    verified against the real `~/.agents/.skill-lock.json` shape on this host) — absent,
    unparseable, or pre-v3 (`version !== 3`) ⇒ empty, rows load without provenance.
  - Per resolved skill: `loadSkillsFromDir({dir: dirname(path)})` (cached per scan root) supplies
    name/description/`disableModelInvocation`/warnings exactly as Pi's loader would — this also
    correctly handles symlinked skill dirs and loose top-level `.md` siblings (the scan recurses
    the whole root; the result is filtered back down to the one matching resolved path).
  - `origin` is derived from `metadata.origin`/`metadata.source`/`metadata.baseDir` (never a path
    prefix guess): `package` when `metadata.origin === "package"`; `settings_path` when
    `metadata.source === "local"` (`resolveLocalEntries`'s tag for explicit `settings.skills`
    path entries); otherwise `agent_dir` when `metadata.baseDir === agentDir`, else `agents_dir`.
  - `symlinkTarget`: `lstat` the skill's own directory, `realpath` if it's a symlink.
  - `provenance`: looked up by name in the lock file, `agents_dir` rows only.
  - Shadowing: a first-wins-by-name reducer over **enabled** rows only, walked in `resolve()`'s
    own precedence order (`resourcePrecedenceRank`: user-local before user-auto before package,
    stable-sorted — `agent_dir` wins over `agents_dir` on a name collision, matching Pi's own
    first-wins semantics, D19). A disabled duplicate is excluded from the reducer entirely, so it
    never wins or shadows.
  - `removable = origin !== "package"`; `baseDir` (never on the wire) is kept per row for the
    toggle task's pattern derivation.
  - Packages: `packages.listConfiguredPackages()` filtered to `scope === "user"`; `kind`/
    `identity`/`pinned` reuse `extensions/curated-packs.ts`'s `parseSource` for `npm:`/`git:`
    sources, anything else is classified `local` (Pi's own `isLocalPath` rule — not `npm:`/`git:`/
    `github:`/`http(s):`/`ssh:`/`builtin:`); `curated` checks the classified identity against
    every `CURATED_PACKS` entry; `filtered` is Pi's own `ConfiguredPackage.filtered`; `skillCount`
    tallies resolved package-origin skills by the same classified identity.
- `packages/server/src/resources/skill-catalog.test.ts` — isolated-HOME fixture tests. `HOME`/
  `PI_CODING_AGENT_DIR` are set to a throwaway bootstrap temp dir before a dynamic `import()` of
  `skill-catalog.js` (mirroring `extensions/sync-executor.test.ts`'s pattern), then reassigned to
  each fixture's own temp dir before every `buildCatalog` call — real fs, no mocked readers, never
  touches the real home.
- `packages/server/AGENTS.md` — documented `pi-sdk.ts`/`skill-catalog.ts` in the `resources/`
  source-layout entry.

## Files created/changed

| File | Change |
|---|---|
| `packages/server/src/resources/pi-sdk.ts` | New — single Pi SDK importer |
| `packages/server/src/resources/skill-catalog.ts` | New — `buildCatalog` |
| `packages/server/src/resources/skill-catalog.test.ts` | New — isolated-HOME fixture tests |
| `packages/server/AGENTS.md` | Documented the two new files in `resources/`'s source layout |

## How it satisfies the scope

Implements exactly task-003's "What to build": `pi-sdk.ts` as the sole Pi-SDK importer re-exporting
`loadSkillsFromDir`, and `skill-catalog.ts`'s `buildCatalog` producing `{skills, packages}` with
every field the spec lists (origin/originLabel/symlinkTarget/lock provenance/`removable`/`baseDir`
kept internal; package `kind`/`identity`/`pinned`/`curated`/`filtered`/`skillCount`). RPC wiring
(task-004) and project-scope skills (deferred, R7) are explicitly out of scope and untouched.

Ground truth for every behavioral claim above came from reading the installed
`node_modules/@earendil-works/pi-coding-agent@1.4.0` dist sources directly — `core/package-manager.js`
(`resolve`, `resolvePackageSources`, `addAutoDiscoveredResources`, `resolveLocalEntries`,
`resourcePrecedenceRank`, `collectSkillEntries`, `collectPackageResources`, `isLocalPath`),
`core/skills.js` (`loadSkillsFromDir`, `loadSkillFromFile`), and `core/settings-manager.js`
(`SettingsManager.create`/`reload`/error-swallowing) — never assumed from the architecture doc's
prose alone. The real v3 lock file shape was verified by reading this host's own
`~/.agents/.skill-lock.json` (read-only; never written).

## Build & test results

```
$ npx vitest run packages/server/src/resources/skill-catalog.test.ts
 Test Files  1 passed (1)
      Tests  7 passed (7)

$ npx vitest run packages/server/src/resources/
 Test Files  2 passed (2)
      Tests  23 passed (23)

$ npm run build:server
> tsc -b packages/server && chmod +x packages/server/dist/daemon/main.js
(clean, no output)

$ npx tsc -b packages/server --force
(clean, no output)
```

Also ran `npx oxfmt packages/server/src/resources/pi-sdk.ts
packages/server/src/resources/skill-catalog.ts packages/server/src/resources/skill-catalog.test.ts`
(clean) and `npx oxlint` on the same three files (zero warnings).

## Acceptance criteria

- [x] Isolated-HOME fixture with skills in `<agentDir>/skills`, `~/.agents/skills`, a fake
      installed package, and a settings path ⇒ each row has the right origin and enabled state —
      `"each origin resolves with the right origin and enabled state"` test (agent_dir/agents_dir/
      package/settings_path, all `enabled:true`, `removable` correct per origin).
- [x] Same name in both skill dirs ⇒ loser has `shadowedBy` = winner path; a disabled duplicate
      shadows nothing — two dedicated tests: the enabled-pair case (`agents_dir` loser's
      `shadowedBy` equals the `agent_dir` winner's path) and the disabled-pair case (a
      `settings.skills` pattern disables only the `agents_dir` instance via its own distinct
      relative pattern; neither row gets `shadowedBy`).
- [x] A symlinked skill dir reports `symlinkTarget` — `"a symlinked skill dir reports
      symlinkTarget"` test (`<agentDir>/skills/linked` → `realpath` of the target).
- [x] Corrupt `settings.json` ⇒ `settings_unreadable`; `settings.json` byte-identical afterwards —
      `"returns settings_unreadable and never rewrites the file"` test (byte-for-byte content
      comparison before/after).
- [x] A curated package (identity in `CURATED_PACKS`) reports `curated: true` — `"a curated package
      (identity in CURATED_PACKS) reports curated: true"` test (`npm:pi-web-access`, a `core`-pack
      entry, uninstalled — curated classification needs no resolve/network).

## Follow-ups/TODO(verify)

None for this task's scope. RPC wiring (task-004) will consume `CatalogSkill`/`CatalogPackage` and
map them to the wire `SkillInfo`/`PiPackageInfo` shapes, dropping the internal `baseDir` field.
