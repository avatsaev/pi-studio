# Task 006 — Summary

- **Sprint:** sprint-056-extensions-sync-engine
- **Status:** done

## What was built

### 1. `ExtensionsService` (`packages/server/src/extensions/extensions-service.ts`)

Orchestration only, per the spec: `sync(reason)` (serialized via `createLimiter(1)` — a sync
requested mid-run awaits the running one, then gets its own fresh `runSync` call, i.e. genuinely
re-plans, not a shared/cached promise) and `describe()` (dry-run: calls `planSync` unchanged, same
code path `sync()` uses to decide actions, so "what we'd do" and "what we report" can never drift).

- Reads `<effectivePiHomeKey>/settings.json` read-only (absent ⇒ empty `packages`; malformed JSON
  ⇒ `outcome: "skipped"`, one `warn`, sync aborts for that pi-home before ever calling the planner).
- Loads `extensions-state.json`; `"unreadable"` ⇒ `outcome: "skipped"`, one `error`, and —
  deliberately — **no** `recordLastSync` write even for that attempt, since the corrupt file must
  never be rewritten for any reason.
- `autoSync: false` gates `bootstrap`/`selection` to a no-op **before** even computing a plan
  (`outcome: "noop"`, one `debug` log); `manual` always runs regardless.
- Unknown pack slugs (`selectEntries`'s `unknownSlugs`) get one `warn` line, once per sync.
- Persists `{ at, outcome }` as `lastSync` via a re-read-then-write (`recordLastSync`) after
  `executePlan` returns, so it never clobbers what the executor wrote per-action.
- Logs the loud summary line only when the plan had actions
  (`installed N of M recommended extensions into <dir>; K failed: <sources> (will retry on next
  start) — disable via daemon.extensions.autoSync=false / PI_STUDIO_EXTENSIONS_AUTOSYNC=false`) —
  `warn` for `partial`/`failed`, `info` otherwise, never `error`.

### 2. Bootstrap wiring (`packages/server/src/daemon/bootstrap.ts`)

- Constructs `ExtensionsService` early (with an `extensions-sync` child logger) and a new
  `DaemonOptions.extensionsInstallSpawn` test-injection hook (production always uses the real
  `defaultInstallSpawn`).
- Added a new readiness log line (`"http/ws server accepting connections"`) immediately after
  `httpServer.listen(...)`, then `void extensionsService.sync("bootstrap").catch(...)` right after
  that — mirroring the existing agent-recovery fire-and-forget block's `.then`/`.catch` shape, but
  positioned **after** `listen()` (agent recovery is required-for-correctness and runs before;
  extensions sync is optional-and-loud and runs after, per the task's own ordering requirement).
- `dev-bootstrap.ts` is **unmodified** (`git status` confirms zero diff) — no dedicated test file
  exists for it (only `dev-main.ts` imports it, never exercised in the suite), so "assert by
  inspection" is the applicable clause from this task's own acceptance criterion; confirmed by
  reading its full source: no `ExtensionsService` import, no reference to `extensions/` at all.

### 3. A real safety bug found and fixed during this task

Running the very first `bootstrap.test.ts` pass after wiring the fire-and-forget kickoff **mutated
the real developer machine's `~/.pi/agent/settings.json`** (confirmed by its mtime) — every
pre-existing `boot()`-started daemon in that file has no `daemon.piHome` set, so
`effectivePiHomeKey` fell back to the real `~/.pi/agent`, and with no injected spawn seam the
service spawned **real** `pi install` against the **real** npm registry. No corruption resulted
(task-001's own findings held: no partial writes, idempotent reinstalls of already-present
packages), and no process was left running, but this was a genuine "tests must stay offline"
violation the sprint's own house rules would have caught in review.

**Fix**: `boot()` now writes `daemon.extensions.autoSync: false` into `config.json` before every
daemon it starts (27 pre-existing tests), and the three other direct `startDaemon(...)` call sites
in the relay-transport section got the same field merged into their existing inline configs. The
two new extensions-specific tests below are the only ones that opt back in, explicitly, with their
own scratch `daemon.piHome` **and** an injected `extensionsInstallSpawn` fake — never the real
network or the real pi-home. Re-verified: `~/.pi/agent/settings.json`'s mtime is unchanged across
every test run performed for this task, and no `pi install` process was ever left running.

### 4. New/extended tests

- `packages/server/src/extensions/extensions-service.test.ts` (new, 11 tests): fresh-pi-home
  install, second-sync noop, `lastSync` persistence + `describe()` round-trip, `autoSync: false`
  gating both `bootstrap`/`selection` while `manual` still runs, malformed `settings.json` →
  `skipped`, corrupt state → `skipped` + file byte-identical, concurrent `sync()` calls serializing
  to one run then a re-plan, and a partial sync logging at `warn` never `error`.
- `packages/server/src/daemon/bootstrap.test.ts` (extended, +2 tests, all 29 pass):
  - Ordering: a captured-log daemon boot with an injected instant-success spawn seam asserts
    `"accepting connections"` appears before the `"installed 5 of 5 recommended extensions"` summary
    line (`vi.waitFor` on the real log stream, no fixed sleep).
  - `daemon.extensions.autoSync=false` ⇒ the injected spawn is never called, verified after
    churning the event loop through a real WS handshake + RPC round trip.

## Live E2E (manual, real network, real bundled `pi`, all in scratch directories)

Ran task-006's own 8-step manual verification against a real daemon:

```
HOME_DIR=$(mktemp -d) ; PI_HOME_DIR=$(mktemp -d)
node packages/cli/dist/cli.js --home "$HOME_DIR" --pi-home "$PI_HOME_DIR" daemon start
```

1. **Fresh boot installs every `core` entry** — log tail (NDJSON, `msg` only):
   ```
   daemon starting
   http/ws server accepting connections
   agent recovery complete
   installed recommended extension   (×5)
   installed 5 of 5 recommended extensions into <PI_HOME_DIR>/agent; 0 failed — disable via …
   ```
2. **Readiness precedes sync** — `"http/ws server accepting connections"` is the 2nd log line,
   before every extensions-sync line (which arrive ~1.5s later — real npm installs, not blocking
   readiness).
3. **`pi list`** (against the same `--pi-home`) shows all five `npm:` entries with real
   `node_modules` paths.
4. **Path-parity proof**: `PI_CODING_AGENT_DIR=<PI_HOME_DIR>/agent node cli.js --mode rpc --verbose`
   immediately emitted `{"type":"extension_ui_request", ..., "title":"Create memory pack?", ...}` —
   `pi-memctx`'s own startup prompt — proving a daemon-spawned-equivalent `pi --mode rpc` process
   pointed at the synced pi-home genuinely loads a curated extension, at spawn, with no model
   credential or completed turn.
5. **Restart ⇒ noop**: stop + restart; log shows `daemon starting` / `accepting connections` /
   `agent recovery complete` and **no** `installed`/summary lines at all.
6. **`pi remove` sticks**: `pi remove npm:pi-powerline-footer` (real removal, confirmed in
   `settings.json`), restart ⇒ `settings.json` unchanged, not re-added, no install log lines.
7. **Hand-pin sticks**: rewrote `npm:pi-web-access` → `npm:pi-web-access@0.22.0` directly in
   `settings.json`, restart ⇒ file byte-identical afterward (still pinned).
8. **`PI_STUDIO_EXTENSIONS_AUTOSYNC=false` on a brand-new home/pi-home** ⇒ log shows no
   `installed`/summary lines, and the pi-home's `agent/` directory was never even created (`ls`
   → "No such file or directory") — zero writes, zero spawns.

All scratch directories removed after; no daemon processes left running; the real
`~/.pi/agent/settings.json` mtime confirmed unchanged before and after this entire task.

## Docs sync

- Root `AGENTS.md`: two new env vars (`PI_STUDIO_EXTENSIONS_AUTOSYNC`, `PI_STUDIO_EXTENSION_PACKS`)
  in the daemon-configuration table; `extensions-state.json` added to the persistence-layout tree.
- `packages/server/AGENTS.md`: new `extensions/` source-layout block (five files, one line each);
  `provider-registry.ts`'s row now documents `resolvePiAgentDir`; a new "Extensions sync
  (`extensions/`)" subsystem-reference section covering all six design invariants.
- `docker/README.md`: `/data` volume bullet now lists `extensions-state.json`; a new bullet
  explains the `PI_STUDIO_HOME`-vs-pi-home distinction and that an unmounted pi-home re-offers the
  full set on every container recreate (harmless, idempotent, but not persisted).

## Test / verification results

- `npm test` (full workspace) — **147 test files, 1713 tests, all pass.**
- `npm run build` (full workspace, including `web-client`) — pass.
- `npm run typecheck` — pass.
- `npm run lint` — clean on every file this task touched (one pre-existing, unrelated warning at
  `bootstrap.ts:203` — outside anything this task changed).
- `npx oxfmt --check` on every sprint-056 file — clean.
- Live E2E — all 8 steps above, verbatim log/settings.json evidence recorded.

## Acceptance criteria

- [x] Fresh boot installs every non-deprecated `core` entry; `pi list` shows them; readiness not
      delayed (log-order verified both in the automated test and the live boot).
- [x] Second boot, unchanged manifest ⇒ zero installs, `outcome: "noop"` (test seam + live log
      absence).
- [x] `--pi-home <dir>` ⇒ sync operates on `<dir>/agent/settings.json` **and** path-parity proven
      live (`pi --mode rpc --verbose` loads `pi-memctx`).
- [x] `PI_STUDIO_EXTENSIONS_AUTOSYNC=false` / `daemon.extensions.autoSync: false` ⇒ no installs,
      never spawns `pi`; `describe()` still works.
- [x] Malformed `settings.json` ⇒ one `warn`, `outcome: "skipped"`, no spawn, file untouched.
- [x] Corrupt `extensions-state.json` ⇒ one `error`, zero actions, file byte-identical.
- [x] Concurrent `sync()` calls serialize: one run then a re-plan.
- [x] Partial sync logs `warn` never `error`, summary line names every failed source + disable hint.
- [x] Offline boot behavior inherited correctly from task 005 (unit-tested there; not re-tested
      live here — would require actually disconnecting network).
- [x] `dev-bootstrap.ts` unmodified; dev daemon never spawns `pi install` (confirmed by inspection —
      no dedicated pre-existing test to run untouched, none exists).
- [x] Docs updated: root/server AGENTS.md, `docker/README.md`.
- [x] Full suite green: `npm run build`, `npm run typecheck`, `npm run lint`, `npm test`.

## Notes / follow-ups

- The "safety bug" above (real-home mutation from unguarded `boot()`) is now permanently closed —
  every daemon `bootstrap.test.ts` starts is extensions-sync-inert by default; the two dedicated
  tests are the only opt-ins, both fully offline (injected spawn seam, scratch `daemon.piHome`).
  Any future test file that calls `startDaemon` directly must follow the same pattern.
- Sprint B (`sprint-057-extensions-cli-rpc`, not part of this task) owns the RPC surface,
  `packages/protocol`/`packages/client`/`packages/cli` changes, and the web-client UI sibling scope
  — nothing here touches those packages.
