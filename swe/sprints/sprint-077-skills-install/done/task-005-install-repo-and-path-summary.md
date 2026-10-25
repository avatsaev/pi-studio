# Task 005 — Install Agent Skills repo picks and host-path entries — Summary

- **Sprint:** sprint-077-skills-install
- **Completed:** 2026-10-25
- **Status:** done

## What was done

Implemented `ResourceService.install`'s `skills_repo` and `local_path` engines
(`installSkillsRepo`/`installLocalPath`, `packages/server/src/resources/resource-service.ts`),
completing the `install()` dispatcher task-004 started. Both are queued through the same
`enqueueMutation` call task-004 uses.

- `installSkillsRepo(ctx, source, picked, replace)`: `picked` empty/absent → single
  `invalid_source` `ItemResult`. For each picked name, a pre-spawn
  `<agentsSkillsDir>/<sanitizeSkillName(name)>/SKILL.md` existence check decides, without a
  `replace` flag, whether it's excluded as `name_exists` (never spawned for that name) or queued
  into `toInstall`. If anything remains, one spawn:
  `[process.execPath, <skills cli>, ...skillsArgv("add", source, toInstall)]` →
  `["add", source, "-g", "-a", "pi", "-y", "-s", ...toInstall]` (source first — `-s` is variadic
  and would otherwise swallow it), 600 s, `{...processEnvSnapshot(), ...spawnEnv(agentDir)}`. Each
  picked name's own `ItemResult` is then decided by a **post-spawn** existence check of the same
  `SKILL.md` path (not the spawn's exit code alone), so "2 of 3 picked installed" surfaces
  correctly per name.
- `installLocalPath(ctx, source)`: `expandHome(source)`; missing/non-directory → `invalid_source`.
  Else a fresh `openPiResources`, de-duplicate any existing `settings.skills` entry with the same
  stripped form (`replacePattern(…, absPath, undefined)` — drops, doesn't re-add), then push a
  **bare** `absPath` and `flush`. One `ItemResult` with `target: absPath`.

  **Deviation from the architecture doc's literal `"+" + absPath` pseudocode**, found while writing
  the first local_path test (it asserted an empty `result.skills` until the entry was changed to
  bare). Code inspection of the installed `@earendil-works/pi-coding-agent` 1.4.0
  (`package-manager.js`): `resolveLocalEntries` splits `settings.skills` into `plain` (no
  `!`/`+`/`-` prefix, no glob) vs. `patterns`; only `plain` entries are scanned via
  `collectFilesFromPaths`. `patterns` (±-prefixed) are consumed exclusively by
  `applyPatterns`/`isEnabledByOverrides` to toggle the enabled state of a path **already**
  discovered via a `plain` entry or `addAutoDiscoveredResources`'s fixed
  `<agentDir>/skills`/`~/.agents/skills` roots — a lone `+<absPath>` for a host directory outside
  those roots, with no matching `plain` entry, resolves zero files. A bare entry goes through the
  `plain` branch instead, which is exactly the shape `remove`'s own pre-existing `settings_path`
  handling already assumed (its test fixture — written in sprint-076 — already used a bare path).
  Both `swe/architecture/pi-resource-management.md` (§ Install pseudocode + a new resolved
  `TODO(verify)`) and `packages/server/AGENTS.md` were updated with this finding; no other spec
  deviation.

## Files changed

| File | Change |
|---|---|
| `packages/server/src/resources/resource-service.ts` | `installSkillsRepo`, `installLocalPath` |
| `packages/server/src/resources/resource-service.test.ts` | `install — skills_repo picks`, `install — local_path` describe blocks |
| `swe/architecture/pi-resource-management.md` | § Install pseudocode corrected (bare, not `+`-prefixed, `local_path` entry); new resolved `TODO(verify)` documenting the code-inspection finding |
| `packages/server/AGENTS.md` | `resources/` tree + prose invariants updated for `install`'s `skills_repo`/`local_path` engines and the deviation |

## Build & test results

```
$ npx vitest run packages/server/src/resources
 Test Files  6 passed (6)
      Tests  97 passed (97)

$ npm run build:server
> tsc -b packages/server && chmod +x packages/server/dist/daemon/main.js
(clean exit)
```

`npx tsc -b --force` (packages/server) and `npx oxlint`/`npx oxfmt` on every changed file: clean.

## Acceptance criteria checked

- [x] Fake spawn: argv contains exactly the picked names; results per name from post-spawn
      existence — "spawns `skills add <src> -g -a pi -y -s <picked…>`…" test: fake spawn only
      creates `alpha` on disk; results are `[{alpha, ok:true}, {beta, ok:false, install_failed}]`,
      derived from the post-spawn existence check, not the spawn's own exit code.
- [x] Existing name without replace ⇒ `name_exists`, not spawned for that name — "a picked name
      already present without replace is excluded…" test: `alpha` pre-exists, only `beta` appears
      in the spawned argv.
- [x] Host path appears once in `settings.skills` and as a `settings_path` row — "appends a bare
      `<absPath>`…" test: `settings.skills` holds `[hostDir]` once (even after installing the same
      path twice), and the returned `skills` list carries an `origin: "settings_path"` row for it.

## Follow-ups

None.
