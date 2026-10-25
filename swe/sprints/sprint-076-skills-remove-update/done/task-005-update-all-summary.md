# Task 005 — `skills_update_all`: `skills update -g -y` + `pi update --extensions` — Summary

- **Sprint:** sprint-076-skills-remove-update
- **Completed:** 2026-10-25
- **Status:** done

## What was done

Added `ResourceService.updateAll()` and wired `skills_update_all_request` through `skills-rpc.ts`
(architecture doc § Behavior & algorithms "Update all", R5):

- `updateAll()` is **one** `enqueueMutation("update_all", "all", "", fn)` call (task-003's shared
  FIFO/logging/re-list/broadcast machinery) whose `fn` spawns `skills update -g -y` (via the
  pinned `skills` CLI, `skills-cli.ts`'s `skillsArgv("update")`) and then `pi update --extensions`
  (via `resolveBundledPiCli()`) **in sequence**, unconditionally — the second spawn always runs
  even when the first fails, since each is an independent `await` with no early return.
- Each spawn gets its own `ItemResult` (`{target: "agent-skills"|"pi-packages", ok, error?,
  stderr?}`); a missing CLI resolves to `{ok:false, error:"spawn_failed"}` without attempting to
  spawn; a nonzero exit or `runSpawn`'s own `"timeout"`/`"spawn_failed"` maps to
  `error: outcome.error ?? "update_failed"` plus the (already redacted/bounded) `stderr`. The
  response's top-level `ok` is `results.every((r) => r.ok)` — true only when both succeed.
- Both spawns share the same `SPAWN_TIMEOUT_MS = 600_000` constant task-004 introduced and the
  same `env` construction (`{...processEnvSnapshot(), ...spawnEnv(agentDir)}`) — no new timeout
  or env-building code was needed, only two more call sites.
- Exactly one re-list + one `skills_changed("mutation")` broadcast for the whole operation (both
  spawns together), since `enqueueMutation`'s tail runs once after `fn()` resolves — not per
  spawn.
- `skills-rpc.ts`'s `skills_update_all_request` handler is a thin one-liner (the request carries
  no payload beyond `type`/`requestId`, so there is no malformed-shape case to guard, unlike
  `remove`/`set_enabled`).

Added 2 new `ResourceService.updateAll` tests (`resource-service.test.ts`) covering both
acceptance criteria directly, plus 2 RPC-level tests (`skills-rpc.test.ts`) covering the
end-to-end dispatch (both engines spawned, correct `ItemResult[]`) and the single
mutation-broadcast-before-response ordering.

## Files changed

| File | Change |
|---|---|
| `packages/server/src/resources/resource-service.ts` | `updateAll()`, `updateAgentSkills()`, `updatePiPackages()` (private); `ItemResult` type import |
| `packages/server/src/resources/resource-service.test.ts` | +2 tests in a new "ResourceService.updateAll" `describe` block |
| `packages/server/src/resources/skills-rpc.ts` | `skills_update_all_request` handler |
| `packages/server/src/resources/skills-rpc.test.ts` | `rpcUpdateAll()` helper; new `skills_update_all_request` describe block (+2 tests) |
| `packages/server/AGENTS.md` | § Pi resource management: new `updateAll` invariant bullet (added alongside task-004's `remove` bullet in the same pass) |

No wire/protocol changes (task-001 already added `skillsUpdateAllRequestSchema`/
`skillsUpdateAllResponseSchema`/`itemResultSchema` and wired them into `sessionMessageSchema`);
no `bootstrap.ts` change (same already-wired `registerSkillsHandlers` call as task-004).

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

$ npx oxlint packages/server/src/resources/{resource-service,resource-service.test,skills-rpc,skills-rpc.test}.ts
(no output — clean)

$ npx oxfmt --check packages/server/src/resources/{resource-service,resource-service.test,skills-rpc,skills-rpc.test}.ts
All matched files use the correct format.
```

## Acceptance criteria

- [x] Both commands spawned with the spec's argv/env (fake spawn) — `resource-service.test.ts`
  "spawns `skills update -g -y` then `pi update --extensions`, in sequence, with the spec's env"
  (asserts both argv tails and `PI_CODING_AGENT_DIR`/`GIT_TERMINAL_PROMPT` on each call) +
  `skills-rpc.test.ts` "spawns both engines and answers ok:true with one ItemResult per engine".
- [x] A failure in the first still runs the second; results report each independently —
  `resource-service.test.ts` "a failure in the first spawn still runs the second; results report
  each independently" (asserts `callCount === 2` and each `ItemResult` independently).

## Follow-ups

None — per-row updates remain explicitly deferred (task's own "Out of scope").
