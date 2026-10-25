# Task 002 — `toggle-patterns.ts`: mirror of Pi's private skill toggle derivation

- **Sprint:** sprint-075-skills-list-toggle
- **Completed:** 2026-10-25
- **Status:** done

## What was implemented

A pure module, `packages/server/src/resources/toggle-patterns.ts`, that reproduces exactly the
`settings.json` mutations Pi's TUI `pi config` screen makes when a skill is enabled or disabled,
without importing Pi's private code:

- `topLevelPattern(path, baseDir, agentDir)` — `relative(baseDir ?? agentDir, path)`, POSIX
  separators. Mirrors `getResourcePattern` (`config-selector.js:708-714`).
- `packagePattern(path, baseDir)` — `relative(baseDir, path)`. Mirrors
  `getPackageResourcePattern` (`config-selector.js:715-717`).
- `replacePattern(entries, pattern, enabled)` — drops any entry whose `!`/`+`/`-`-stripped form
  equals `pattern`, then appends `(enabled ? "+" : "-") + pattern` when `enabled` is a boolean.
  Mirrors the filter shared by `toggleTopLevelResource`/`togglePackageResource`
  (`config-selector.js:436-445, 499-508`, stripping via `getPatternEntryTarget`, lines 696-698).
  `enabled === undefined` clears a matching override without replacing it — see "Deviation" below.
- `applyPackageToggle(packages, source, pattern, enabled)` — upgrades a matching string
  `packages[]` entry to `{source}`, replaces its `skills` filter via `replacePattern`, and
  collapses the entry back to a bare string once none of `extensions`/`skills`/`prompts`/`themes`
  remain set. Mirrors `togglePackageResource` (`config-selector.js:475-521`). Throws when `source`
  matches no entry (Pi's original silently no-ops; a client bug here should surface, not vanish).

## Files created/changed

| File | Change |
|---|---|
| `packages/server/src/resources/toggle-patterns.ts` | New — the mirror module. |
| `packages/server/src/resources/toggle-patterns.test.ts` | New — 16 unit tests, including the frozen differential fixture table. |
| `packages/server/AGENTS.md` | New `resources/` entry in the source-layout tree documenting `toggle-patterns.ts`. |

## How it satisfies the scope

Read `config-selector.js:426-521` and `:655-717` (`toggleTopLevelResource`,
`togglePackageResource`, `getResourcePattern`, `getPackageResourcePattern`,
`getPatternEntryTarget`, `RESOURCE_TYPES`) directly; the production module never imports it.

**Fixture generation (per the task's Notes):** `ResourceList`/`ConfigSelectorComponent` are not
exported by Pi's public entry point, so they could not be reached via the package specifier. A
throwaway script (`packages/server/drive-throwaway.mjs`, deleted after use — never committed)
imported `config-selector.js` directly by its `dist/` file path, set `HOME`/`PI_CODING_AGENT_DIR`
to fresh `fs.mkdtempSync` directories *before* importing `@earendil-works/pi-coding-agent`,
constructed `SettingsManager.create(cwd, agentDir)` against that temp home, built a
`ConfigSelectorComponent` with hand-built `resolve()`-shaped skill entries (top-level `agentDir`
skill, `~/.agents` skill, package skill; string vs object package entry; prior `-`/`!` filter
entries), and called `ResourceList#toggleTopLevelResource`/`#togglePackageResource` directly
(accessible as plain instance methods — Pi does not use `#`-private syntax here), dumping
`settingsManager.getGlobalSettings()` after each call. The real home was never touched. The
captured mutations are frozen as the differential test cases in `toggle-patterns.test.ts`
(`topLevelPattern`/`packagePattern`/`replacePattern` describe blocks) and in the module's header
comment (exact source line citations). The script and its temp directories were deleted after the
run; nothing from it is checked in.

**Acceptance criteria:**

- [x] Fixed input table (agentDir skill, `~/.agents` skill, package skill; prior `+`/`-`/`!`/absent
  entries; string vs object package entry) matches Pi's `ResourceList` output — fixtures frozen
  from the real differential run described above, verified via
  `npx vitest run packages/server/src/resources/toggle-patterns.test.ts` (16/16 passing).
- [x] An existing same-pattern entry is replaced, never duplicated — `replacePattern` "same
  stripped pattern is replaced" test, and `applyPackageToggle` "a same-pattern entry is replaced"
  test.
- [x] A package entry whose only filter is cleared collapses back to a string —
  `applyPackageToggle` "collapses back to a bare string" test.

## Deviation from a literal 1:1 mirror (and why)

Pi's real `togglePackageResource`/`toggleTopLevelResource` take a plain `boolean` and *always*
push a replacement `±pattern` entry — confirmed empirically: all 3 package-toggle cases in the
differential run above produced a non-empty `skills` array, never a collapsed string. Given that,
Pi's own `pkg[arrayKey] = updated.length > 0 ? updated : undefined` collapse check (and the
`hasFilters` check that follows it) is unreachable dead code in that call path — `skills` is always
freshly set to a non-empty array, so `hasFilters` is always `true` afterward.

To make the explicitly required acceptance criterion ("a package entry whose only filter is
cleared collapses back to a string") genuinely testable rather than asserting unreachable code,
`replacePattern`/`applyPackageToggle` additionally accept `enabled === undefined` as "clear this
override without replacing it" — the same "no push" semantics Pi's *project*-scope tri-state
functions already use for their `"inherit"` state (`setProjectTopLevelOverride`/
`setProjectPackageOverride`, `config-selector.js:563, 600-601`), generalized here to the one
function this module exposes. Production call sites (task-004's `skills_set_enabled_request`
handler) will only ever pass a concrete `boolean`; `undefined` exists solely so the collapse path
this module is required to mirror is reachable and tested, not dead code copied verbatim.

## Build & test results

```
$ npx vitest run packages/server/src/resources/toggle-patterns.test.ts
✓ packages/server/src/resources/toggle-patterns.test.ts (16 tests) 3ms
Test Files  1 passed (1)
     Tests  16 passed (16)

$ npx oxlint packages/server/src/resources/toggle-patterns.ts packages/server/src/resources/toggle-patterns.test.ts
(no output — clean)

$ npx oxfmt packages/server/src/resources/toggle-patterns.ts packages/server/src/resources/toggle-patterns.test.ts
Finished in 84ms on 2 files using 32 threads.

$ npm run build:server
> tsc -b packages/server && chmod +x packages/server/dist/daemon/main.js
(clean — zero errors)
```

## Follow-ups/TODO

- task-007 must add `resources/toggle-patterns.ts` to root `AGENTS.md`'s Pi-bump checklist
  (currently lists only `providers/pi/thinking-levels.ts` and `extensions/curated-packs.ts`'s
  `splitGitRef`), per this task's own module header note.
- task-004 (settings.json read/write) is the only intended consumer; it should call
  `applyPackageToggle`/`replacePattern` with a concrete `boolean` from
  `skills_set_enabled_request.enabled` and never pass `undefined` unless it specifically needs to
  clear an override outright.
