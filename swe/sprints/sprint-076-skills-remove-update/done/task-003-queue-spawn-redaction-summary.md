# Task 003 — `ResourceService` FIFO queue, spawn runner, credential redaction, mutation logging — Summary

- **Sprint:** sprint-076-skills-remove-update
- **Completed:** 2026-10-25
- **Status:** done

## What was done

Built the shared machinery every spawned skills-manager mutation (install/remove/update_all —
tasks 004/005/077) will run on, against `ResourceService`'s existing `list()`/`setEnabled()`:

- **`spawn-runner.ts` (new).** Two pure/independent pieces:
  - `runSpawn(spawn: InstallSpawn, command, env, timeoutMs)` → `{ok, error?: "spawn_failed" |
    "timeout", exitCode, stderr}`. Interprets the injected `InstallSpawn` seam's result/throw: a
    thrown spawn → `spawn_failed`; `timedOut: true` → `timeout`; otherwise `ok` reflects
    `exitCode === 0` with no `error` set (callers map a plain nonzero exit to their own
    `install_failed`/`remove_failed`/`update_failed`). stderr is redacted **before** it's bounded
    to 2 048 bytes, so truncation can never leave a partial, unredacted credential.
  - `redactSource(source)` (pure) — strips `user[:password]@` from URL-like substrings
    (`:\/\/[^@/\s]*@` → `://`) and masks `token`/`access_token` query values
    (`[?&](?:access_)?token=...` → `...=***`).
- **`ResourceService` additions:**
  - `private readonly queue = createLimiter(1)` — a FIFO separate from `ExtensionsService`'s own
    sync mutex. `list()`/`setEnabled()` still bypass it entirely (unchanged, D21).
  - `spawn?: InstallSpawn` constructor dep (defaults to `extensions/sync-executor.ts`'s
    `defaultInstallSpawn`; tests inject a fake) + public `runSpawn(command, env, timeoutMs)` method
    delegating to `spawn-runner.ts`'s `runSpawn`.
  - Public `enqueueMutation<T>(op, kind, source, fn: (ctx) => Promise<T>)` — the clean extension
    point tasks 004/005/077 build their concrete operations on. Runs `fn(ctx)` behind `this.queue`,
    then unconditionally: logs `{op, kind, source: redactSource(source), outcome, durationMs}`
    (info; warn with the redacted `stderr` on failure), re-lists via the existing `loadResult`, and
    broadcasts `skills_changed("mutation")` — matching the architecture doc's "Install" pseudocode
    (re-list/broadcast happen even on a failed spawn, since settings may have partially changed).
    `fn`'s own `ok`/`error` wins over the re-list's; if the re-list itself fails (e.g.
    `settings.json` became unreadable mid-operation) that error surfaces instead. `skills`/
    `packages` always come from the fresh re-list.
  - `handleFsEvent` now also folds (skips) while `queue.activeCount > 0 || queue.pendingCount > 0`,
    on top of the existing `ownWriteUntil` window — a queued mutation's own settings/skill-dir
    churn folds into its own `"mutation"` broadcast rather than firing a stray `"external"` push
    mid-operation (architecture doc § Queue, watcher, broadcast: "Events during a queued mutation
    fold into its own broadcast").

No wire/RPC/bootstrap changes — `bootstrap.ts`'s existing `new ResourceService({...})` call is
unaffected since `spawn` is optional and defaults to `defaultInstallSpawn`.

## Files changed

| File | Change |
|---|---|
| `packages/server/src/resources/spawn-runner.ts` | New — `runSpawn`, `redactSource`, `SpawnOutcome` |
| `packages/server/src/resources/spawn-runner.test.ts` | New — 10 tests: `redactSource` (5), `runSpawn` (5) |
| `packages/server/src/resources/resource-service.ts` | `queue`, `spawn` dep, `runSpawn` method, `enqueueMutation`, fs-event fold while queue active |
| `packages/server/src/resources/resource-service.test.ts` | `makeService` gained a `spawn` override; +3 tests: FIFO ordering + concurrent `setEnabled`, timeout-then-proceeds, log/broadcast-on-failure |
| `packages/server/AGENTS.md` | `resources/` tree: `spawn-runner.ts` entry, expanded `resource-service.ts` entry; § Pi resource management: new queue/spawn/redaction invariant bullet, updated watcher-fold and out-of-scope bullets |

## Build & test results

```
$ npx tsc -b --force packages/server
(no output — clean)

$ npx vitest run packages/server/src/resources
 ✓ packages/server/src/resources/spawn-runner.test.ts (10 tests)
 ✓ packages/server/src/resources/skills-cli.test.ts (6 tests)
 ✓ packages/server/src/resources/toggle-patterns.test.ts (16 tests)
 ✓ packages/server/src/resources/skills-rpc.test.ts (6 tests)
 ✓ packages/server/src/resources/skill-catalog.test.ts (7 tests)
 ✓ packages/server/src/resources/resource-service.test.ts (10 tests)
 Test Files  6 passed (6)
      Tests  55 passed (55)

$ npx oxlint packages/server/src/resources/{resource-service,resource-service.test,spawn-runner,spawn-runner.test}.ts
(clean after hoisting one test-scoped function flagged by consistent-function-scoping)

$ npm run build:server
> tsc -b packages/server && chmod +x packages/server/dist/daemon/main.js
(no output — clean)
```

## Acceptance criteria

- [x] Two queued operations run strictly in submission order; a `setEnabled` issued meanwhile
      completes immediately — `resource-service.test.ts` "two queued mutations run strictly in
      submission order; a concurrent setEnabled isn't blocked by the queue".
- [x] A timed-out spawn returns `timeout` and the queue proceeds — `resource-service.test.ts` "a
      timed-out spawn returns error:'timeout' and the queue proceeds to the next mutation";
      `spawn-runner.test.ts` "reports error:'timeout' and proceeds when the seam reports timedOut".
- [x] `git:https://user:tok@host/r?access_token=x` is fully redacted — `spawn-runner.test.ts`
      "fully redacts a userinfo credential and a token query value" (exact string from the
      acceptance criterion).

## Follow-ups

- Tasks 004 (remove), 005 (update_all), and the 077 install slice should call
  `service.enqueueMutation(op, kind, source, fn)` and `service.runSpawn(...)` rather than
  reimplementing queueing/logging/redaction.
- `preview` (sprint-077) shares the same FIFO per the architecture doc but not the
  relist/broadcast tail `enqueueMutation` provides (preview is stateless/no mutation) — it should
  go through the raw queue directly rather than `enqueueMutation`, which this task didn't need to
  expose since no preview operation exists yet in this sprint.
