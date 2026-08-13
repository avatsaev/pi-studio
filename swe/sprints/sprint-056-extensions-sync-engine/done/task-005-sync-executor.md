# Task 005 — Executor: per-package failure isolation, classification, per-action state writes

- **Sprint:** sprint-056-extensions-sync-engine
- **Status:** done
- **Type:** feature
- **Area:** packages/server (extensions)
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** task-001, task-003, task-004

## Goal

Run a `SyncPlan` by spawning `pi install <spec>` per action through an injectable seam, where **one
package failing never aborts the run**, and every outcome — success or failure — is committed to the
state file before the next action starts.

## Context / why

This is where tenet 5 lives: *every package succeeds or fails alone*. A pack is a **selection, never a
transaction**. One entry that 404s, needs credentials, times out, or crashes its own postinstall must
not prevent the others from installing and must not fail the sync as a whole. Partial success is a
first-class, fully-supported end state — not a daemon error. Nothing is ever rolled back; successful
installs stay installed.

State is written after **each** action rather than batched, so a crash or `kill -9` mid-sync loses
neither the successes already achieved nor the failure diagnostics already gathered.

Installs run **sequentially**: they share npm caches and pi's settings file, so parallelism buys
little and risks races.

Task 001's findings are direct inputs here — especially whether `PI_CODING_AGENT_DIR` is honoured on
the write path and how much of npm's stderr survives. If task 001 found stderr is swallowed behind a
generic message, `classify()` legitimately collapses to `install_failed`/`unknown` for most cases and
the two `reason`-specific criteria below relax to match what was observed. Classification is cosmetic
by design — it never affects control flow.

## Scope references

- `swe/features/preinstalled-extensions.md` § Executor — per-package failure isolation (the pseudocode,
  the env table, the `ExtensionFailureReason` taxonomy), § State file (`offered`/`failures` write
  rules), § RPC surface (`SyncReport` shape and the `outcome` derivation), § Error Handling (every
  failure row), design tenet 5
- `swe/features/preinstalled-extensions.md` § TODO(verify) — as resolved by task-001
- `packages/server/src/agent/providers/pi/rpc-transport.ts:66,92-96` — `resolveBundledPiCli()`,
  `defaultPiCommand()` (the `[process.execPath, cli, …]` shape to mirror)
- `packages/server/src/extensions/extensions-state.ts` — `effectivePiHomeKey` (task 003): the **only**
  source for the install env's `PI_CODING_AGENT_DIR`
- `packages/server/src/extensions/sync-planner.ts` — `SyncPlan` (task 004)
- `packages/server/src/extensions/extensions-state.ts` — state store (task 003)
- `packages/cli/src/pi-commands.ts` + `pi-commands.test.ts:128-146` — the injectable-spawn-runtime /
  fake-runtime idiom to mirror for testability
- Create: `packages/server/src/extensions/sync-executor.ts` (+ `.test.ts`)

## What to build

```ts
export type ExtensionFailureReason =
  | "not_found" | "unauthorized" | "network" | "timeout"
  | "install_failed" | "spawn_failed" | "unknown";

export interface SyncReport {
  at: string;
  outcome: "ok" | "noop" | "partial" | "failed" | "skipped";
  installed: string[];
  failures: { identity: string; source: string; pack: string;
              reason: ExtensionFailureReason; message: string }[];
}

/** Injectable process seam — tests pass a fake; production spawns the bundled pi. */
export interface InstallSpawn {
  (args: { command: string[]; env: Record<string, string>; timeoutMs: number }):
    Promise<{ exitCode: number | null; stderr: string; timedOut?: boolean }>;
}

export async function executePlan(plan: SyncPlan, deps: {
  home: string; piHomeKey: string; config: PersistedConfig;
  spawn?: InstallSpawn; logger: Logger; now?: () => Date;
}): Promise<SyncReport>;
```

Loop body, exactly per the spec — **always the full action list, no early break**:

- `cmd = [process.execPath, resolveBundledPiCli(), "install", action.source]`
- `env = { ...process.env, PI_CODING_AGENT_DIR: effectivePiHomeKey(config), GIT_TERMINAL_PROMPT: "0",
  GIT_SSH_COMMAND: "ssh -oBatchMode=yes", npm_config_yes: "true" }`. The agent dir comes from the
  **same shared derivation as the state key and the spawn path** — never from raw
  `piHomeEnv(daemon.piHome)`, which ignores the `agents.providers.pi.env.PI_CODING_AGENT_DIR`
  override and would break path parity for exactly that config (installs land in one dir, state and
  agents read another). The git/ssh guards are cheap insurance so a future git-hosted entry fails
  fast instead of blocking sync on a credential or host-key prompt; v1's sources are all npm.
- The **seam** owns the 180 s timeout and the process-tree kill (that is why it takes `timeoutMs` and
  returns `timedOut`); the executor only interprets the result. The production seam is the one place
  that actually spawns.
- exit 0 → write `offered[identity] = { installedSpec: action.source, atVersion: SERVER_VERSION, at }`,
  **delete** `failures[identity]`, push to `report.installed`.
- non-zero → `recordFailure(identity, classify(result), tail(stderr, 2 KB))`.
- **any throw** (spawn ENOENT, timeout, unexpected error) → same `recordFailure` path; nothing escapes
  a single action's scope.
- `finally` → persist state after every action, success or failure.

`recordFailure` increments `failures[identity].attempts`, stores `reason`/`message`/`at`, and appends a
`report.failures` row. It **never** records the identity in `offered`, which is precisely why the entry
is retried on the next sync with no retry bookkeeping.

`outcome` is **derived**, never tracked: `noop` = empty plan; `ok` = actions ran, zero failures;
`partial` = ≥1 success and ≥1 failure; `failed` = every attempted action failed; `skipped` = could not
start at all. `resolveBundledPiCli() === null` is the single whole-sync abort → `skipped`, one clear
log line, and **no fabricated `failures[]` rows** for packages never attempted.

`classify()` maps exit code + stderr patterns to the taxonomy (404 → `not_found`, 401/403 →
`unauthorized`, DNS/ECONNREFUSED/ETIMEDOUT/5xx → `network`, timeout kill → `timeout`, other non-zero →
`install_failed`, launch failure → `spawn_failed`, else `unknown`). Best-effort: `unknown` is a fully
acceptable outcome and a misclassification is cosmetic, never functional.

## Out of scope

- Deciding *what* to install (task 004 owns the plan).
- The in-process mutex, reading `settings.json`, bootstrap wiring, logging summary lines (task 006).
- Any protocol/client/CLI surface (sprint B).

## Acceptance criteria

- [ ] **Isolation (primary):** with a seam where the 2nd of 4 actions fails, all 4 are attempted
      (assert seam call count == 4); the 3 successes are in `offered`; the report is
      `outcome: "partial"` with exactly one `failures[]` row carrying
      `identity`/`source`/`pack`/`reason`/`message`.
- [ ] **A throwing seam cannot abort the run:** a seam that *throws* (not merely exits non-zero) on
      one action still yields a complete report and every later action attempted.
- [ ] **Multiple failures are all reported:** 3 of 5 fail with three different causes ⇒ 3 distinct
      `failures[]` rows, no truncation, no collapsing into a count, both successes committed,
      `outcome: "partial"`.
- [ ] Re-running against the resulting state retries **only** the failed identities (assert seam call
      count equals the failure count).
- [ ] `attempts` increments across successive failing runs for the same identity; a later success
      deletes that `failures` record and adds the identity to `offered`.
- [ ] State is persisted after **every** action: simulate an abort after action 2 of 4 and assert the
      on-disk state contains action 1's success and action 2's failure.
- [ ] Empty plan ⇒ `outcome: "noop"`, seam never called, no state write.
- [ ] `resolveBundledPiCli() → null` ⇒ `outcome: "skipped"`, zero `failures[]` rows, seam never called.
- [ ] Env assertion: the seam receives `GIT_TERMINAL_PROMPT="0"`, `GIT_SSH_COMMAND` with
      `BatchMode=yes`, `npm_config_yes="true"`, and `PI_CODING_AGENT_DIR` equal to
      `effectivePiHomeKey(config)` — asserted for a plain `daemon.piHome` config **and** for one
      whose `agents.providers.pi.env.PI_CODING_AGENT_DIR` override differs (the path-parity
      regression case).
- [ ] A seam result of `timedOut: true` is reported `reason: "timeout"` and the run continues with
      the next action.
- [ ] The **production seam** kills a hung process tree: one small real-process test (spawn
      `node -e "setInterval(()=>{},1e3)"` with a millisecond-scale `timeoutMs`, assert exit +
      `timedOut: true`) — still offline and fast.
- [ ] `classify()` unit cases cover each taxonomy value, using stderr samples captured by task 001
      where available; `unknown` for unrecognisable input.
- [ ] No test spawns a real `pi` or touches the network.

## Test / verification plan

- Build: `npm run build:server` succeeds.
- Typecheck: `npm run typecheck` succeeds.
- Lint/format: `npx oxlint <changed files>`, `npx oxfmt --check <changed files>` clean.
- Tests: create `packages/server/src/extensions/sync-executor.test.ts` with an injected `InstallSpawn`
  fake and a temp `$PI_STUDIO_HOME`; run `npx vitest run packages/server/src/extensions`; all pass.
- No fake timers needed: the executor's timeout case feeds `timedOut: true` through the fake seam;
  the production-seam kill test uses a real short-lived child with a tiny `timeoutMs`.

## Notes

- Bound the captured stderr (≈2 KB tail) — an npm failure can emit megabytes, and this string lands
  in the state file, the log, and (in sprint B) the wire.
- Never log or store an env value that could carry a credential; log the identity, reason, and the
  bounded message only.
- The spec's primary isolation criterion also asserts the successes are "present in `settings.json`" —
  that half is unverifiable with a fake seam (only real `pi` writes `settings.json`) and is covered
  by task 006's live run instead (its step 3 proves the write path). This task's `offered`-based
  assertions are the deliberate executor-level half of that criterion.
- If task 001 recorded that `pi install` needs any non-interactive flag beyond these three env vars,
  add it here and note the deviation in the summary.
