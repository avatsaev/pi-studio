# Task 006 — `ExtensionsService`, bootstrap fire-and-forget sync, live E2E, docs sync

- **Sprint:** sprint-056-extensions-sync-engine
- **Status:** done
- **Type:** feature + test + docs
- **Area:** packages/server (extensions, daemon/bootstrap); root/server AGENTS.md; docker/README.md
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** task-002, task-003, task-004, task-005

## Goal

Wire the pieces into one service, run it fire-and-forget from the production daemon after the WS
server is listening, and prove end-to-end on a real daemon with a real pi that a fresh boot installs
the `core` pack into the exact directory a spawned agent loads from.

## Context / why

This is the task that turns four modules into the product promise: *install Pi-Studio, get the
recommended extensions*. It is also the first time anything reads pi's `settings.json` or spawns a
real `pi install`.

Sync must **never delay daemon readiness** (tenet 4). The daemon already has the right precedent for
this: agent recovery at `bootstrap.ts:792-798` is a `void`-ed promise with `.then`/`.catch` logging.
Sync follows it — kicked off after `httpServer.listen(...)` (`bootstrap.ts:811`), never awaited.

`dev-bootstrap.ts` is **deliberately excluded**: the mock-only dev daemon must never touch a real
pi-home's settings.

The first-ever sync for a pi-home is **not consent-gated** — that is the "preinstalled" product
promise — but it must be loud, and it must be trivially disableable via one config key or one env var.

## Scope references

- `swe/features/preinstalled-extensions.md` § New/changed files (`extensions-service.ts` row),
  § Lifecycle — when sync runs, § Concurrency, § Data & Persistence, § Error Handling
  (`settings.json` unreadable, `autoSync: false`, unknown slug, docker ephemeral home, concurrent
  daemons), § Acceptance Criteria
- `swe/architecture/daemon-bootstrap.md` — bootstrap ordering and readiness
- `packages/server/src/daemon/bootstrap.ts:792-798` — the fire-and-forget precedent to mirror;
  `:811` `httpServer.listen`; `:450-451` the `FileWatchService` + `register…` service-wiring idiom
- `packages/server/src/daemon/dev-bootstrap.ts` — **must stay untouched**
- `packages/server/src/logging/logger.ts` — `Logger`, child-logger convention
- Tasks 002–005' modules
- Create: `packages/server/src/extensions/extensions-service.ts` (+ `.test.ts`)
- Modify: `packages/server/src/daemon/bootstrap.ts` (+ `bootstrap.test.ts`)
- Docs: root `AGENTS.md` (persistence-layout tree, env-var table), `packages/server/AGENTS.md`,
  `docker/README.md`

## What to build

**1. `ExtensionsService`** — orchestration only; all decisions already live in the planner/executor:

```ts
export class ExtensionsService {
  constructor(deps: { home: string; config: PersistedConfig; logger: Logger; spawn?: InstallSpawn });
  /** Plan + execute. Serialized: a call arriving mid-run awaits the running one, then re-plans. */
  sync(reason: "bootstrap" | "manual" | "selection"): Promise<SyncReport>;
  /** Dry-run: the same planner, no writes — statuses for reporting. */
  describe(): Promise<{ autoSync: boolean; selected: string[]; entries: PlannedEntry[]; lastSync?: { at, outcome } }>;
}
```

- Reads pi's global `settings.json` at `<effectivePiHomeKey>/settings.json` — **read-only, never
  written**; all mutations go through `pi install`. Absent file ⇒ empty `packages`. Malformed JSON ⇒
  skip sync for that pi-home with a `warn` and `outcome: "skipped"` (the planner must not act on a
  reality it cannot read).
- `autoSync: false` ⇒ `sync("bootstrap")` and `sync("selection")` execute **no** actions and never
  spawn `pi`; `sync("manual")` still runs (the explicit manual path); `describe()` always works.
- Unknown pack slugs from config are logged `warn` once and ignored (`selectEntries`' `unknownSlugs`).
- In-process serialization behind a promise-chain mutex; a sync requested while one runs awaits it and
  then **re-plans** (config may have changed).
- Cross-process (two daemons, one pi-home): accepted as benign, logged at `debug`. No lockfile.
- Persists the `{ at, outcome }` summary as `lastSync` so `describe()` can report the previous run on a
  freshly-booted daemon that has not synced yet.

**2. Bootstrap wiring** in `bootstrap.ts`: construct the service, then after `httpServer.listen(...)`
kick off `void service.sync("bootstrap")` with `.then`/`.catch` structured logging on an
`extensions-sync` child logger — mirroring the agent-recovery block. Never awaited, never inside the
listen callback's critical path.

**3. First-sync logging** — loud but never alarming: one `info` per installed package, one `warn` per
failed package (`identity`, `reason`, `message`), and one summary line naming counts and every failed
source:
`installed N of M recommended extensions into <agent dir>; K failed: <sources> (will retry on next
start) — disable via daemon.extensions.autoSync=false / PI_STUDIO_EXTENSIONS_AUTOSYNC=false`.
A `partial` sync logs at `warn`, **never** `error` — nothing is broken and the daemon is fully usable.

**4. Live E2E** (manual, recorded in the summary — not a committed network test): boot a real daemon
against a throwaway `PI_STUDIO_HOME` and `--pi-home`, and verify the ordering, the installs, path
parity with a spawned agent, and the kill switch. Steps in the criteria below.

**5. Docs sync** (docs-sync rule): root `AGENTS.md` persistence-layout tree (`extensions-state.json`)
and env-var table (both new vars); `packages/server/AGENTS.md` (the `extensions/` source-layout rows
and the sync invariants); `docker/README.md` (the volume requirement — without a mounted
`$PI_STUDIO_HOME`/pi-home, every container recreate re-offers into a fresh pi-home).

## Out of scope

- Protocol messages, RPC handlers, client SDK, CLI `extensions` group, `packages/cli`/`packages/protocol`
  AGENTS.md — all sprint B (`sprint-057-extensions-cli-rpc`).
- `dev-bootstrap.ts` — must remain untouched by design.
- Any push/broadcast of sync progress.

## Acceptance criteria

- [ ] Fresh daemon boot (production bootstrap, empty state, default config) installs every
      non-deprecated `core` entry into the effective pi-home's global settings via `pi install`;
      pi's own `pi list` shows them.
- [ ] Daemon readiness is **not** delayed: the WS-accepting log line precedes the first
      extensions-sync log line, verified in a real boot's logs.
- [ ] Second boot with an unchanged manifest performs zero installs and reports `outcome: "noop"`
      (assert via the injected spawn seam in tests; confirm log absence live).
- [ ] With `--pi-home <dir>`, sync operates on `<dir>/agent/settings.json` **and** a daemon-spawned
      `pi --mode rpc` session actually loads a curated extension — the end-to-end path-parity proof.
- [ ] `PI_STUDIO_EXTENSIONS_AUTOSYNC=false` and `daemon.extensions.autoSync: false` each ⇒ boot
      performs no installs and never spawns `pi`; `describe()` still reports statuses.
- [ ] Malformed `settings.json` ⇒ one `warn`, `outcome: "skipped"`, no spawn, file left untouched.
- [ ] Corrupt `extensions-state.json` ⇒ one `error`, zero actions, file left byte-identical.
- [ ] Concurrent `sync()` calls serialize: two overlapping calls produce one run then a re-plan (the
      second sees the first's state), asserted with a seam that blocks.
- [ ] A partial sync logs at `warn` (never `error`), emits one line per failed package, and the summary
      line names every failed source plus the disable hint.
- [ ] Offline boot (npm unreachable) ⇒ daemon healthy, `outcome: "failed"`, every failure logged,
      `offered` not polluted; a later online sync completes the installs.
- [ ] `dev-bootstrap.ts` is unmodified and the dev daemon never spawns `pi install` (assert by
      inspection + an existing dev-bootstrap test still passing untouched).
- [ ] Docs updated: root `AGENTS.md` (persistence tree + both env vars), `packages/server/AGENTS.md`,
      `docker/README.md` volume note.
- [ ] Full suite green: `npm run build`, `npm run typecheck`, `npm run lint`, `npm test`.

## Test / verification plan

- Build: `npm run build` succeeds (whole workspace, not just server).
- Typecheck: `npm run typecheck`; Lint: `npm run lint`; Format: `npx oxfmt --check <changed files>`.
- Tests: create `packages/server/src/extensions/extensions-service.test.ts` (injected seam, temp home,
  fake settings.json — offline); extend `packages/server/src/daemon/bootstrap.test.ts` with the
  ordering assertion and the `autoSync: false` no-spawn case. Run `npm test` (full suite) at the end
  of the sprint.
- Manual live run, recorded verbatim in the summary:
  1. `PI_STUDIO_HOME=$(mktemp -d) pi-studio --pi-home $(mktemp -d) daemon start`
  2. tail the log: readiness line first, then per-package `info` lines, then the summary line
  3. `pi list` (against the same `--pi-home`) shows the five `core` packages
  4. start an agent session and confirm a curated extension is loaded by the spawned `pi --mode rpc`
     — observable at spawn (pi's startup extension listing / debug log); no model credential or
     completed turn is required
  5. restart the daemon ⇒ no installs, `noop`
  6. `pi remove` one package, restart ⇒ it is **not** re-added (status `user_removed`)
  7. hand-pin one entry in `settings.json`, restart ⇒ untouched (`user_modified`)
  8. set `PI_STUDIO_EXTENSIONS_AUTOSYNC=false` on a fresh home ⇒ no installs, no `pi` spawn

## Notes

- Keep `ExtensionsService` thin: read inputs, call the pure planner, hand the plan to the executor,
  persist, log. Any real decision belongs in task 004's planner where it is unit-testable.
- The `describe()` dry-run must reuse the planner unchanged — one code path for "what we'd do" and
  "what we report" is why sprint B's `extensions list` cannot drift from sync.
- Step 6/7 of the manual run are the tenet-1 proof; do them on a real pi-home, not a fixture.
- If task 001 found `PI_CODING_AGENT_DIR` is not honoured on the write path, the path-parity criterion
  here is the one that will fail — check the resolution recorded in task 001's summary **before**
  starting.
