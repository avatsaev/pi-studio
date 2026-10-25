# Task 004 — Remove: every skill origin and whole packages — Summary

- **Sprint:** sprint-076-skills-remove-update
- **Completed:** 2026-10-25
- **Status:** done

## What was done

Added `ResourceService.remove(target)` (`{path}` xor `{packageSource}`), queued through
sprint-076/task-003's `enqueueMutation`, and wired `skills_remove_request` through
`skills-rpc.ts` (architecture doc § Behavior & algorithms "Remove", D9/D20):

- **`remove({path})`** re-resolves the catalog, finds the row, then picks a removal strategy by
  origin:
  - `origin === "package"` → `not_removable` (D9: only a whole package, never one of its skills,
    can be removed).
  - `settings_path` → drops the literal directory entry (any `±` form) from `settings.skills` via
    `toggle-patterns.ts`'s `replacePattern`; files are never touched.
  - A symlinked skill dir (`lstat(skillDir).isSymbolicLink()`) → `fs.unlink`s the link itself —
    `unlink` never follows a symlink, so the real target directory (e.g. another package's
    install root) survives.
  - `agents_dir` with a `.skill-lock.json` entry (`row.provenance` set) → spawns
    `skills remove -g -y <name>` via the pinned `skills` CLI (`skills-cli.ts`'s `skillsArgv`,
    never `-a`, per D18/D20 — `-a pi` would silently keep the canonical copy).
  - A plain directory under `agent_dir`/`agents_dir` with no lock entry → `fs.rm(recursive)`,
    but only once `realpath(skillDir)` is verified to stay inside the origin root
    (`<agentDir>/skills` or `~/.agents/skills`, resolved with its own `realpath`) — refused as
    `not_removable` otherwise. Verified against a genuine escape: a directory discovered through
    a *symlinked ancestor* directory (Pi's resolver follows symlinked subdirectories while
    scanning, confirmed by a throwaway script against the real `DefaultPackageManager.resolve()`
    before writing the test), not just a symlinked leaf.
  - Every non-`settings_path` branch then also drops the row's toggle `±pattern` (derived the
    same way `setEnabled` does, via `topLevelPattern(row.path, row.baseDir, agentDir)`) from
    `settings.skills`, so a stale enable/disable override never lingers after the skill is gone.
- **`remove({packageSource})`**: `not_found` if no matching `packages[]` entry in the fresh
  catalog, else spawns bundled `pi remove <source>` (`resolveBundledPiCli()`,
  `agent/providers/pi/rpc-transport.ts`) — Pi owns deleting the install root and the
  `packages[]` entry itself.
- Every spawn (`skills remove`, `pi remove`) uses a new shared `SPAWN_TIMEOUT_MS = 600_000` (the
  architecture doc's § Timeouts bound) and an `env` built as
  `{...processEnvSnapshot(), ...spawnEnv(agentDir)}` — `spawnEnv` (`skills-cli.ts`, task-002)
  supplies the fixed override set (`PI_CODING_AGENT_DIR`, `GIT_TERMINAL_PROMPT=0`, etc.); the new
  `processEnvSnapshot()` (added to `spawn-runner.ts`, mirroring `extensions/sync-executor.ts`'s
  own unexported helper of the same shape) spreads underneath it so the spawned `skills`/`pi`
  child still has `PATH` to find `git`/`node`.
- `skills-rpc.ts`'s `skills_remove_request` handler re-validates the wire schema's
  `path`-xor-`packageSource` shape itself (same posture as `skills_set_enabled_request`'s
  existing malformed-shape guard, since `ctx.message` is an unvalidated
  `Record<string, unknown>`), answering a domain `{ok:false, error:"invalid request: …"}` —
  never `rpc_error` — on a bypassing client.
- `markOwnWrite`/re-list/broadcast are **not** duplicated inside `remove`'s implementation —
  `enqueueMutation` (task-003) already does exactly one `markOwnWrite()` + re-list + broadcast
  after `fn()` resolves, so the removal strategies above only perform their own direct file/
  settings work and return `{ok, error?, stderr?}`.

Added 9 new `ResourceService.remove` tests (`resource-service.test.ts`) covering all 5
acceptance criteria plus `not_removable`-on-a-package-row's-own-path, `not_found` (both forms),
and a spawn-failure → `remove_failed` + `stderr` case; and 4 new RPC-level tests
(`skills-rpc.test.ts`) covering the malformed-xor guard, an end-to-end `settings_path` removal
through the real router, `not_found`, and the mutation broadcast ordering.

## Files changed

| File | Change |
|---|---|
| `packages/server/src/resources/resource-service.ts` | `remove()`, `removeByPath()`, `removePackage()` (private); `SPAWN_TIMEOUT_MS` constant; new imports (`lstat`/`realpath`/`rm`/`unlink`, `resolveBundledPiCli`, `resolveSkillsCli`/`skillsArgv`/`spawnEnv`, `processEnvSnapshot`) |
| `packages/server/src/resources/resource-service.test.ts` | +9 tests across two new `describe` blocks: "remove-by-path" and "remove-by-package" |
| `packages/server/src/resources/skills-rpc.ts` | `skills_remove_request` handler; `SkillsRpcDeps`/doc comment updated to cover the full family |
| `packages/server/src/resources/skills-rpc.test.ts` | `boot()` gained a `spawn` override; `rpcRemove()` helper; new `skills_remove_request` describe block (+4 tests) |
| `packages/server/src/resources/spawn-runner.ts` | New export `processEnvSnapshot()` |
| `packages/server/AGENTS.md` | `resources/` tree: `resource-service.ts`/`skills-rpc.ts`/`spawn-runner.ts` entries expanded; § Pi resource management: new `remove` invariant bullet, "Out of scope" bullet narrowed to install/preview only |

No wire/protocol changes (task-001 already added `skillsRemoveRequestSchema`/
`skillsRemoveResponseSchema` and wired them into `sessionMessageSchema`); no `bootstrap.ts`
change (`registerSkillsHandlers` was already wired in sprint-075, and this task only adds a
handler registration *inside* that same function).

## Build & test results

```
$ npx vitest run packages/server/src/resources
 ✓ packages/server/src/resources/spawn-runner.test.ts (10 tests)
 ✓ packages/server/src/resources/toggle-patterns.test.ts (16 tests)
 ✓ packages/server/src/resources/skills-cli.test.ts (6 tests)
 ✓ packages/server/src/resources/skills-rpc.test.ts (12 tests)
 ✓ packages/server/src/resources/skill-catalog.test.ts (7 tests)
 ✓ packages/server/src/resources/resource-service.test.ts (21 tests)
 Test Files  6 passed (6)
      Tests  72 passed (72)

$ npx tsc -b --force packages/server
(no output — clean)

$ npm run build:server
> tsc -b packages/server && chmod +x packages/server/dist/daemon/main.js
(no output — clean)

$ npx oxlint packages/server/src/resources/{resource-service,resource-service.test,skills-rpc,skills-rpc.test,spawn-runner}.ts
(no output — clean)

$ npx oxfmt --check packages/server/src/resources/{resource-service,resource-service.test,skills-rpc,skills-rpc.test,spawn-runner}.ts
All matched files use the correct format.
```

(Test counts above include task-005's `updateAll` tests, implemented in the same pass — see that
task's own summary.)

## Acceptance criteria

- [x] Symlink removal leaves the target directory intact — `resource-service.test.ts` "removes a
  symlinked skill by unlinking the link only, leaving its target directory intact".
- [x] Lock-tracked removal spawns `skills remove -g -y <name>` without `-a` (asserted on argv)
  and the row disappears — `resource-service.test.ts` "lock-tracked removal spawns `skills remove
  -g -y <name>` without `-a`; the row disappears" (fake spawn also performs the real `rm`, so a
  follow-up catalog scan genuinely no longer finds it).
- [x] Settings-path removal leaves files on disk — `resource-service.test.ts` "removes a
  settings_path entry from settings.skills, leaving its files on disk" + the RPC-level
  "removes a settings_path skill by path and reflects it in a fresh list".
- [x] A dir whose realpath escapes its root is refused and untouched — `resource-service.test.ts`
  "refuses and leaves untouched a dir whose realpath escapes its origin root via a symlinked
  ancestor" (constructed via a symlinked *ancestor* directory under `agentDir/skills`, verified
  against Pi's real resolver — it does follow symlinked subdirectories while scanning — before
  writing the assertion).
- [x] Package removal spawns `pi remove <source>` — `resource-service.test.ts` "removes a whole
  package by spawning `pi remove <source>`".

## Follow-ups

None — install (task-077) is explicitly out of scope and unaffected by this task's additions
(`enqueueMutation`/`runSpawn`/`processEnvSnapshot` are all already shared, reusable machinery).
