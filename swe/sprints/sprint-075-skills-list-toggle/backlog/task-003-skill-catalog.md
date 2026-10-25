# Task 003 — `pi-sdk.ts` + `skill-catalog.ts`: build the skill list from Pi's resolver

- **Sprint:** sprint-075-skills-list-toggle
- **Status:** backlog
- **Type:** feature
- **Area:** packages/server (resources)
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** task-001

## Goal

A function that returns `{skills: SkillInfo[], packages: PiPackageInfo[]}` exactly as Pi would load them, computed fresh on every call.

## Context / why

Pi is the source of truth (no cache, no Pi-Studio state). `pi-sdk.ts` is the single importer of Pi's SDK so a Pi bump has one place to check.

## Scope references

- swe/architecture/pi-resource-management.md § Ground truth, § List, § Error handling
- packages/server/src/extensions/extensions-state.ts:110 (`effectivePiHomeKey`)
- packages/server/src/extensions/curated-packs.ts (`CURATED_PACKS`, `identityOf`)
- packages/server/src/agent/provider-auth/pi-auth-runtime.ts (in-process Pi import precedent)
- Create: packages/server/src/resources/pi-sdk.ts, skill-catalog.ts (+ tests)

## What to build

- `pi-sdk.ts`: `openPiResources(agentDir, cwd)` → `{settings: SettingsManager (reloaded), packages: DefaultPackageManager}`; re-exports `loadSkillsFromDir`. The only file importing these Pi symbols.
- `skill-catalog.ts`: `buildCatalog({agentDir, home, lockPath, readFile…})`:
  - corrupt `<agentDir>/settings.json` ⇒ `{ok:false, error:"settings_unreadable"}` (missing file is fine = empty settings);
  - `resolve(onMissing → "skip")`, user scope only;
  - per skill: frontmatter name/description/`disable-model-invocation`, warnings, `origin` (package / agents_dir / agent_dir / settings_path), `originLabel`, `symlinkTarget`, lock provenance for agents_dir, `removable = origin !== "package"`, `baseDir` kept internally for toggles;
  - shadowing via the loader's `collision` diagnostics over enabled paths only;
  - packages from settings: `kind`, `identity`, `pinned`, `curated`, `filtered`, `skillCount`.
- Lock path: `$XDG_STATE_HOME/skills/.skill-lock.json` if set, else `~/.agents/.skill-lock.json`; absent or unparseable ⇒ no provenance.

## Out of scope

- RPC wiring (task-004)
- Project-scope skills (deferred, R7)

## Acceptance criteria

- [ ] Isolated-HOME fixture with skills in `<agentDir>/skills`, `~/.agents/skills`, a fake installed package, and a settings path ⇒ each row has the right origin and enabled state
- [ ] Same name in both skill dirs ⇒ loser has `shadowedBy` = winner path; a disabled duplicate shadows nothing
- [ ] A symlinked skill dir reports `symlinkTarget`
- [ ] Corrupt settings.json ⇒ `settings_unreadable`; settings.json byte-identical afterwards
- [ ] A curated package (identity in `CURATED_PACKS`) reports `curated: true`

## Test / verification plan

- `npx vitest run packages/server/src/resources/skill-catalog.test.ts` (tests set `HOME` and `PI_CODING_AGENT_DIR` to a temp dir)
- `npm run build:server`
