# Daemon self-update — live results

What the live check (`scripts/daemon-update-check/`, recipe and flags in its README) proved against a
real global npm install. Spec: `swe/features/self-update.md` § Acceptance criteria and § TODO(verify).
Each run is dated; the newest is first.

## 2026-11-24 — all ten scenarios pass

**Setup.** Clean `git worktree` of `b5e9602` with the two fixes below applied, `npm ci` and
`npm run build` in the worktree; packages `protocol, relay, client, server, web-client, cli` packed
from it and published at `0.0.9001` (N), `0.0.9002` (N+1) and `0.0.9003` (N+2, `dist/daemon/main.js`
starts with `process.exit(3)`) to a verdaccio container only (no uplink for `@av-pi-studio/*`).
Daemon host: `node:22-bookworm-slim` (Node 22.23.5, npm 10.9.9, Docker 29.10.0) as `node` (uid 1000)
with `prefix=/home/node/.npm-global` (folder owned by `node`, mode 755); `docker run --init` (a bare
`sleep` as PID 1 does not reap the old daemon, and the helper would wait its 30 s for a zombie).
The relay is `docker/relay.Dockerfile` as built from the worktree. Three SDK clients: two direct (with
the password) and one through the relay. Command: `node scripts/daemon-update-check/run.mjs --repo
/tmp/wt-daemon-update --out results.json`; 74 expectations, exit 0, about three minutes. Containers,
network, images, scratch folder and worktree were removed afterwards.

| # | Scenario | Result | Evidence |
|---|---|---|---|
| 1 | Setup | pass | `npm i -g @av-pi-studio/cli@0.0.9001` took 7 s; `pi-studio --version` 0.0.9001; global root `/home/node/.npm-global/lib/node_modules` |
| 2 | The offer | pass | `/api/health` `0.0.9001`; `:6767` bound on `0.0.0.0`; `installKind: npm-global`; the start's automatic check made 1 request and found `idle`; after `0.0.9002` was published one client's check reached the other direct client and the relay client as an `available 0.0.9002` broadcast, with no request of their own |
| 3 | Apply N → N+1 | pass | see below |
| 4 | `daemon stop` | pass | `daemon stopped`; `pi-studio.pid` gone; `/api/health` silent; no daemon process; start again (pid 775) and all three clients reconnected |
| 5 | Rollback N+2 → N+1 | pass | see below |
| 6 | Read-only npm folder | pass | `chmod a-w <npm root -g>`; `cannot_update`, `reason: not_writable`, `version 0.0.9003`, `command: npm i -g @av-pi-studio/cli@latest && pi-studio daemon restart`; a forged apply → `{ok:false,error:"cannot_update"}` |
| 7 | Folder made read-only after the check | pass | `available` while writable; then `chmod a-w` on `<root>` and `<root>/@av-pi-studio`; apply `ok`; broadcasts `["installing","failed"]`: `failed(permission, 0.0.9003)` with npm's EACCES output (`rename … @av-pi-studio/cli → .cli-…`); no `updating_extensions`, no `restarting`; same daemon pid (1349), `/api/health` still `0.0.9002`, client A's socket never dropped; the next check replaced `failed` by `available` |
| 8 | Auto-check | pass | `PI_STUDIO_UPDATE_AUTOCHECK=false`: 0 requests for the cli packument in the 8 s after the start; `autoCheck:false`, `checkedAt` unset, state `idle`; Check now → `available 0.0.9003`. The Settings call `setDaemonUpdateAutoCheck(true)` wrote `daemon.update.autoCheck: true` to `config.json` while the effective value stayed `false` (env wins). Restart without the env: `autoCheck:true`, the start's check found `available`. Switch off: `config.json` `false`; restart: 0 requests in 8 s. The 6 h timer is not observable live (`update-service.test.ts`, fake timer) |
| 9 | Rollback, registry stopped, cache warm | pass | registry container stopped at the `restarting` broadcast; the helper finished 5 s later: three failed starts of `0.0.9003`, `npm install -g …@0.0.9002 --prefer-offline` from npm's cache, `rolled_back`; `0.0.9002` answers, `lastResult.outcome = rolled_back` |
| 10 | Rollback fails too (registry stopped, `npm cache clean --force`) | pass | `npm install` of the previous version failed after 75 s (`ENOTFOUND duplive-registry`); the helper wrote `outcome: failed`; no daemon, no pid file, the broken `0.0.9003` stayed installed; after `npm i -g …@0.0.9002` and `pi-studio daemon start`, `lastResult.outcome = failed` was read once (`update-result.json` removed) |

### Scenario 3 — apply `0.0.9001 → 0.0.9002` in detail

- Before: a `pi` agent (spawned by its first prompt; the process renames itself `pi`) and a terminal.
  Old daemon pid 308; its tree: 308 (`node … runDaemon`), 384 (`pi`), 385 (`/bin/sh`, the terminal).
- Client A's `apply` answered `ok`; client B's apply right after was refused `{ok:false,error:"in_progress"}`.
- All three clients saw `installing → updating_extensions → restarting` and reconnected by themselves
  6 s after the apply (install 4.3 s, extensions step 0.2 s; the log has no `extensions update failed`).
- After: `/api/health` `0.0.9002`, still bound on `0.0.0.0:6767`; `pi-studio.pid` names pid 481, a live
  `node …/@av-pi-studio/cli/node_modules/@av-pi-studio/server/dist/daemon/main.js`; none of 308/384/385
  exists; no `pi` process at all. `lastResult = {from 0.0.9001, to 0.0.9002, outcome updated}` on every
  client; `update-result.json` was consumed.
- `update-restart.log`: helper started → old daemon exited after 0.3 s → `start 0.0.9002, try 1/3` →
  `answers with version 0.0.9002` 0.5 s later → `update updated`.

### Scenario 5 — broken `0.0.9003` rolled back

Check → `available 0.0.9003`; apply; helper log: old daemon exited, `start 0.0.9003` tries 1/3, 2/3, 3/3 each
`the daemon exited; stopping it` (0.5 s apart), `installing 0.0.9002 again`, `start 0.0.9002, try 1/3`
answers, `update rolled_back`. Clients reconnected 10 s after the apply; `/api/health` `0.0.9002`;
`lastResult = {from 0.0.9002, to 0.0.9003, outcome rolled_back, message "0.0.9003 did not start on
0.0.0.0:6767; back on 0.0.9002."}`; pid file names the live daemon (1002, was 775); installed packages
all `0.0.9002`.

## Spec acceptance criteria covered

| Criterion | Status |
|---|---|
| A global npm install reports `npm-global`; a newer version reaches every client without a reload | covered: scenario 2 (the pill itself is sprint 137) |
| Update on npm: installed, extensions, same address, direct and relay client reconnect | covered: scenario 3 (`Updated to X` is the workbench's reading of `lastResult`, not run here) |
| After the restart no old `pi` process; the pid file names the new daemon; `daemon stop` removes it | covered: scenarios 3 and 4 |
| A folder made read-only after the check leaves the old daemon running, no restart | covered: scenario 7 |
| A new version that does not start is rolled back | covered: scenario 5 (`failed, back on Y` is the dialog's reading of `lastResult`) |
| A second apply during an update is refused `in_progress` | covered: scenario 3 |
| `PI_STUDIO_UPDATE_AUTOCHECK=false`, Check now, the switch writes `config.json` | covered: scenario 8 |
| Docker and checkout `cannot_update`; the dialog's counts; `daemon restart` ×20; health check; desktop | not part of this check |

## Bugs found and fixed

1. **`lastResult` never reached the new daemon after a successful update or a rollback**
   (`packages/server/src/update/update-service.ts`). The helper writes `update-result.json` only after
   the new daemon answers `/api/health` with the expected version, but the daemon read the file once,
   at start-up, before that: on both the `updated` and the `rolled_back` path the file was written
   after the read and stayed on disk, so no client ever saw the result (only `failed`, where no daemon
   is running, worked). Found in the first apply (`lastResult` undefined; `update-result.json` still
   present). Fix: while `lastResult` is empty the service polls the file every 500 ms for 30 s
   (`RESULT_POLL_MS`, `RESULT_WATCH_MS`, own `resultTimer` seam, cleared by `close()`); the first read
   removes the file, sets `lastResult` and broadcasts. Regression tests in `update-service.test.ts`
   (a result written after start-up is taken, broadcast and the poll stops; no poll when start-up found
   it; the window ends; `close()` clears it).
2. **A rollback with the registry unreachable stalled for the whole 120 s and failed**
   (`packages/server/src/update/helper.ts`). `npm install -g <pkg>@previous` retried the dead registry
   until the helper's 120 s limit killed it (125 s in the first run; the result was `outcome: failed`,
   no daemon), although the previous version was in npm's cache. Fix: `--prefer-offline` on that
   install (now 5 s with a warm cache; with the registry stopped *and* the cache cleaned it still fails,
   after 75 s, and leaves the daemon down with `outcome: failed`, scenario 10). Regression test in
   `helper.test.ts` (the real script against a fake `npm`: it records `install -g
   @av-pi-studio/cli@9.9.8 --prefer-offline`, and the result is `rolled_back`).

## TODO(verify) answered

- **Rollback with the registry stopped / npm's cache.** A plain `npm install -g <previous>` does not
  work without the registry (retries until killed at 120 s). With `--prefer-offline` it works from npm's
  cache in about 2 s (also verified by hand: `npm install -g …@0.0.9003 --prefer-offline`, then back to
  `…@0.0.9002`, registry stopped). The cache only misses if it was cleaned (scenario 10).
- **The daemon's entry path under npm's layout.** `npm i -g @av-pi-studio/cli` nests the server under the
  CLI: `<root>/@av-pi-studio/cli/node_modules/@av-pi-studio/server/dist/daemon/main.js`; there is no
  `<root>/@av-pi-studio/server`. This held before and after the update and the rollback, so the
  helper's second candidate is the one that matters in practice; a hoisted layout (the server also
  installed globally on its own) was not exercised.

## Observations (not changed)

- After a rollback the next check offers the broken version again (`available 0.0.9003` right after the
  rolled-back daemon started, and again every 6 h): clients show the pill again. The spec says a newer
  version is "found by the next check"; remembering a rolled-back version is a design follow-up.
- A rollback install killed at its time limit leaves an empty message (`Command failed: npm install …`
  and nothing else), because nothing was written to stderr; with a network error npm's own text
  (`ENOTFOUND …`) is carried. Adding "timed out after 120 s" for the killed case would help.
- `failed(permission)`'s message ends with npm's generic hints (`sudo chown -R 1000:1000 "/home/node/.npm"`);
  the `EACCES … rename` line that explains it is earlier in the same message.
