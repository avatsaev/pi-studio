# Task 004 — Install `npm:`/`git:` Pi packages, skills-only — Summary

- **Sprint:** sprint-077-skills-install
- **Completed:** 2026-10-25
- **Status:** done

## What was done

Implemented `ResourceService.install(source, picked?, replace?)`'s `pi_npm`/`pi_git` engine
(`installPiPackage`, `packages/server/src/resources/resource-service.ts`) and wired
`skills_install_request`/`skills_install_response` through `skills-rpc.ts` and
`daemon/bootstrap.ts`, reusing the existing `enqueueMutation` FIFO queue (shared with
`remove`/`updateAll`): one call drives logging, `markOwnWrite`, re-list, and the
`skills_changed("mutation")` broadcast.

- `install()` runs `detectSkillSource(source)` once and dispatches on the daemon's own result
  (never a client-sent `kind`) inside `installSource`, which `switch`es to
  `installPiPackage`/`installSkillsRepo` (task-005)/`installLocalPath` (task-005); an unrecognized
  source is a single `invalid_source` `ItemResult`.
- `installPiPackage` spawns `[process.execPath, <bundled pi cli>, "install", source]` (600 s,
  `{...processEnvSnapshot(), ...spawnEnv(agentDir)}`). A nonzero exit or timeout is a single
  failed `ItemResult` (`install_failed`/`timeout` + stderr); the service still re-lists afterward
  via `enqueueMutation`'s own tail, since settings may have partially changed.
- On spawn success, a second, independent step: fresh `openPiResources` (re-reads
  `settings.json` from disk — the spawned `pi install` already wrote it), `piPackageIdentity`
  (new module-level helper wrapping `curated-packs.ts`'s `parseSource(...).identity`, ref/version
  stripped, `null` on a non-`npm:`/`git:` entry) matches the installed entry by identity
  regardless of exact version/ref, then upgrades it to skills-only object form
  (`extensions: [], prompts: [], themes: []`) while spreading the existing entry first — so any
  pre-existing `skills` filter array survives untouched, matching task-001's spike finding that
  `addSourceToSettings` only ever rewrites `source`. A failure in this step (entry not found,
  write error) is its own failed `ItemResult` with **no rollback** of the already-successful
  package install (D25) — the package row simply shows `filtered: false` on the next list.
- One `ItemResult` per install, `target: source`.

## Files changed

| File | Change |
|---|---|
| `packages/server/src/resources/resource-service.ts` | `install()`, `installSource`, `installPiPackage`, `piPackageIdentity` helper, `curated-packs.ts`/`toggle-patterns.ts` (`PiPackageEntry`/`PiPackageSource`) imports |
| `packages/server/src/resources/skills-rpc.ts` | `skills_install_request` handler + shape guard (`source` required string, `skills`/`replace` optional) |
| `packages/server/src/daemon/bootstrap.ts` | (shared with task-003's `studioHome` change) |
| `packages/server/src/resources/resource-service.test.ts` | `install — pi_npm/pi_git packages` describe block |
| `packages/server/src/resources/skills-rpc.test.ts` | `skills_install_request` describe block |
| `packages/server/AGENTS.md` | `resources/` tree + prose invariants updated for `install` |

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

- [x] With a fake spawn that writes a bare entry like Pi does, the final settings.json holds the
      object form with the three empty arrays — "a fake spawn that writes a bare entry (like `pi
      install` does for a new package)…" test: fake spawn writes `{packages: ["npm:fresh-pkg"]}`;
      final settings hold `{source, extensions:[], prompts:[], themes:[]}`.
- [x] A pre-existing `skills` filter on the entry survives — "a pre-existing skills filter on the
      matched entry survives the filter write" test: seeded `{source:"npm:old-x", skills:["foo"]}`,
      fake spawn leaves it as-is (mirroring `addSourceToSettings`'s real behavior), final entry is
      `{source, skills:["foo"], extensions:[], prompts:[], themes:[]}`.
- [x] Spawn timeout ⇒ `timeout`, queue proceeds — "a spawn timeout answers timeout; the queue
      proceeds to the next mutation" test.

## Follow-ups

None.
