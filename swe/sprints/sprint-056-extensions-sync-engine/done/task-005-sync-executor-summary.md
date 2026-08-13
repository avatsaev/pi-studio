# Task 005 — Summary

- **Sprint:** sprint-056-extensions-sync-engine
- **Status:** done

## What was built

- `packages/server/src/extensions/sync-executor.ts`:
  - `InstallSpawn` seam, `ExtensionFailureReason`, `SyncReport` types per the spec.
  - `defaultInstallSpawn` — the production seam: spawns `command` with `stdio: ["ignore", "ignore",
    "pipe"]` (stdin explicitly ignored — task-001 found `install` never prompts, but this closes
    the door structurally too), captures stderr, and on timeout kills the **whole process tree**
    via `tree-kill` (same library/pattern as `rpc-transport.ts`'s `createProcessTransport`), not
    just the direct child.
  - `classify(input)` — one function handling both a resolved spawn result (non-zero exit/timeout)
    and a caught throw, per the spec's own pseudocode shape. Pattern-matches `404`/`E404` →
    `not_found` (verified verbatim against task-001's real evidence), `401`/`403`/`E401`/`E403` →
    `unauthorized` (task-001's documented best-effort fallback — no live 401/403 was ever observed),
    `ENOTFOUND`/`ECONNREFUSED`/`ETIMEDOUT`/`EAI_AGAIN`/5xx → `network`, `timedOut: true` → `timeout`,
    `ENOENT` in a thrown message → `spawn_failed`, else `install_failed` (exit path) / `unknown`
    (throw path).
  - `executePlan(plan, deps)` — the full per-action loop: empty plan → `noop` (no state
    read/write, seam never called); `resolveBundledPiCli() === null` → `skipped` (same, no state
    touch); otherwise loads state via `loadExtensionsState`, treats `"unreadable"` as `skipped`
    (never overwrites a corrupt file — the executor's own instance of the state fail-safe), then
    runs every action **sequentially, full list, no early break**, wrapped in try/catch so a throw
    never escapes one action's scope, `finally`-persisting state after every single action. Success
    writes `offered` + deletes any `failures` entry; failure/throw goes through `classify` +
    `recordFailure` (increments `attempts`, never touches `offered`). `outcome` is derived, never
    tracked, from the final `installed`/`failures` counts.
  - `PI_CODING_AGENT_DIR` is computed **fresh from `deps.config`** via `effectivePiHomeKey` on every
    call, not trusted from the separately-passed `deps.piHomeKey` (which is used only to index
    `state.piHomes`) — so a hypothetical caller mistake in `piHomeKey` can never redirect where
    packages are actually installed; the two are guaranteed to agree by construction on the correct
    call path (task 006's service computes both from the same `config` at the same time).
- `packages/server/src/extensions/sync-executor.test.ts` — 15 tests covering: the primary isolation
  criterion (2nd of 4 fails, all 4 attempted, 3 offered, 1 `failures[]` row); a throwing seam;
  3-of-5 failing with 3 distinct causes, all reported; retry-only-the-failed on a second run;
  `attempts` incrementing then clearing on a later success; per-action persistence surviving a
  simulated mid-run abort; empty-plan `noop`; no-bundled-CLI `skipped` (via a scoped `vi.mock` of
  `resolveBundledPiCli` only, toggled per-test — mirrors `file-watch-service.test.ts`'s
  `fakeHomeDir` idiom); env assertions for both the plain and the override `PI_CODING_AGENT_DIR`
  case; `timedOut: true` → `reason: "timeout"` with the run continuing; three tests against the
  **real** `defaultInstallSpawn` (a real short-lived child, a real spawn-failure rejection, and the
  real process-tree-kill-on-timeout case task-005 explicitly calls for — the one test in this file
  that genuinely needs the platform clock, commented as such); and `classify`'s full taxonomy.

## Test / verification results

- `npx vitest run packages/server/src/extensions` — 5 files, **61 tests, all pass** (15 new in
  `sync-executor.test.ts`; the other 46 are the untouched sprint-so-far suites).
- `npm run build:server` — pass.
- `npm run typecheck` — pass.
- `npx oxlint packages/server/src/extensions/sync-executor.ts
  packages/server/src/extensions/sync-executor.test.ts` — clean (fixed two lint classes along the
  way: `.sort()` → `.toSorted()` for non-mutating array comparisons, and a scoping warning by
  hoisting one fully-closure-free spawn fake to module scope).
- `npx oxfmt --check <changed files>` — clean.
- No test spawns a real `pi` or touches the network — confirmed by inspection (only
  `process.execPath -e "..."` short-lived Node subprocesses in the three `defaultInstallSpawn`
  tests).

## Acceptance criteria

- [x] Isolation (primary): all 4 actions attempted despite the 2nd failing; 3 successes in
      `offered`; `outcome: "partial"`; exactly one `failures[]` row with full detail.
- [x] A throwing seam cannot abort the run.
- [x] Multiple failures (3 of 5, three distinct causes) are all reported, no truncation/collapsing.
- [x] Re-running retries only the failed identities (seam call count == failure count).
- [x] `attempts` increments across failing runs; a later success clears `failures` + adds `offered`.
- [x] State persisted after every action (simulated abort mid-run leaves partial progress on disk).
- [x] Empty plan ⇒ `noop`, seam never called, no state write.
- [x] `resolveBundledPiCli() → null` ⇒ `skipped`, zero `failures[]` rows, seam never called.
- [x] Env assertion (guards + `PI_CODING_AGENT_DIR === effectivePiHomeKey(config)`) for both the
      plain and the provider-override config.
- [x] `timedOut: true` ⇒ `reason: "timeout"`, run continues.
- [x] The production seam kills a hung process tree — real short-lived-child test.
- [x] `classify()` covers every taxonomy value, using task-001's captured stderr samples where
      available (the 404 case); `unknown` for unrecognisable input.
- [x] No test spawns a real `pi` or touches the network.

## Notes for task 006

- `executePlan`'s `deps` shape matches the task's own contract exactly:
  `{ home, piHomeKey, config, spawn?, logger, now? }` — the service only needs to construct these
  and pass the planner's `SyncPlan` straight through, no translation.
- The `unauthorized` classify branch is unverified against a live 401/403 (task-001's documented
  gap) — this is by design, not a gap introduced here.
