# Task 006 - End-to-end verification across daemon + CLI, and the docs sweep - Summary

**Sprint:** sprint-057-extensions-cli-rpc
**Status:** done
**Completed:** 2026-08-13

## What was implemented

### 1. Real end-to-end integration test (automated)

`packages/server/src/daemon/bootstrap.test.ts` - extended the existing "extension packs RPC
(sprint-057)" describe block with two tests that talk `extension_packs_list_request` /
`extension_packs_set_request` over a **real WebSocket connection** to a **booted daemon**
(`boot()` + `startDaemon()`, not the in-process service), using the **real
`ExtensionPacksListResponse`/`ExtensionPacksSetResponse` schemas** from `@av-pi-studio/protocol`
to validate the wire payload (not a hand-rolled cast):

- `"extension packs RPC (sprint-057)"` - list request returns the real curated catalog
  (`autoSync`, `packs[]` with `pi-memctx` etc, `selected: []` before any sync).
- `"full round trip: list -> set(with packs) -> set(without packs, one seeded failure) ->
  list"` (task-006) - drives a 4-step scenario against one daemon connection: initial list,
  `set({ packs: ["core"] })` (real installs via a fake spawn that mirrors genuine `pi install`
  argv/behavior, including writing `settings.json` itself so the planner's pre-existing-entry
  check runs authentically), a `set({})` manual-retry call with **one seeded package failing**
  (`pi-web-access` returns exit 1 / `npm error 404 Not Found` on its first attempt, succeeds on
  retry), then a final list confirming the state converged. Asserts `report.outcome === "partial"`
  on the failing set-response, then `"noop"` on the follow-up no-op sync, and that the final list's
  `packs` reflects every entry as `"installed"`.

Both tests were run against pre-fix code first (git-stashed) to confirm they fail without the
sprint's RPC wiring, then restored.

### 2. Manual 8-step live verification (real daemon, real `pi`, real npm registry - no fakes)

Executed against three disposable `PI_STUDIO_HOME` directories (`/tmp/pi-studio-e2e{,-2,-3}`,
all removed after the run) with the **actual production daemon binary**
(`packages/server/dist/daemon/main.js`) and the **actual CLI binary** (`packages/cli/dist/cli.js`),
never the dev daemon or a mock provider:

1. **Fresh daemon boot, `autoSync` default (true).** Daemon log showed
   `installed 5 of 5 recommended extensions`; `pi list` inside that pi-home independently
   confirmed all 5 packages physically present under `agent/npm/node_modules/`.
2. **`extensions list`** - all 5 rows `installed`, table matches the curated catalog exactly.
3. **`pi remove npm:pi-web-access`** (the real `pi` CLI, not a daemon RPC) - removed the package
   and rewrote `settings.json` to 4 entries.
4. **`extensions list`** after the removal - `pi-web-access` row now reads `user_removed`, the
   other 4 unchanged.
5. **`extensions sync`** (autoSync still true) - `installed 0 of 0`, exit 0, `settings.json`
   byte-identical; `pi-web-access` was never reinstalled. Repeated the same sync after restarting
   the daemon with `PI_STUDIO_EXTENSIONS_AUTOSYNC=false` - manual sync still ran (exit 0, same
   noop result), proving the manual path bypasses the boot gate as designed. (Both this run and the
   truly-gated boot skip render identically as `installed 0 of 0` when there is nothing pending;
   the structural bypass itself is what `extensions-service.test.ts`'s "autoSync: false -> manual
   sync still runs" test asserts directly - this manual run corroborates the CLI/RPC path
   end-to-end but can't visually distinguish "gated" from "ran, nothing to do" in this exact empty
   state.)
6. **Hand-pinned `pi-memctx` to `@0.4.1`** by editing `settings.json` directly (simulating a user
   version pin) - `extensions list` showed `user_modified`; a follow-up `extensions sync` left the
   file byte-for-byte unchanged (the planner's pre-existing/pinned-entry guard, blocker-1's fix,
   holds under real `pi`/npm, not just the unit-test fakes).
7. **Fresh second pi-home**: ran real `pi install npm:pi-memctx@0.8.0` *before* the daemon's first
   boot, then booted a fresh daemon against that pi-home. Boot log read
   `installed 4 of 4 recommended extensions` (not 5) and `extensions list` showed `pi-memctx` as
   `user_modified` while the other 4 read `installed` - the daemon adopted the pre-existing pin
   instead of overwriting it, and `settings.json` still contained the exact pre-installed
   `npm:pi-memctx@0.8.0` entry, byte-unchanged, after boot.
8. **`extensions list --local`** with the daemon stopped rendered a **byte-identical** table to
   the daemon-backed list from step 7 - the in-process planner path and the daemon path can never
   drift on the same on-disk state, because both call the identical `PiStudioClient`-shared
   rendering function (`renderExtensionsList`), not a hand-rolled second table formatter.
9. **`extensions select nope`** (unknown pack slug) - printed `unknown pack: nope`, exited 1,
   `config.json` untouched (verified via `diff` against a pre-call snapshot) - matches the existing
   `agent ls`-style CLI error convention exactly (root-option-first is enforced identically; a
   confirming probe of `extensions list -H ... --json` before the root option also failed with
   `unknown option '--json'`, same failure shape as an existing `agent ls` command, not a
   regression).
10. **Hostile network** - booted a fresh third daemon with `NPM_CONFIG_REGISTRY` pointed at an
    unreachable local port (`http://127.0.0.1:1/`, `ECONNREFUSED`, npm retries disabled for a fast
    failure) and `autoSync: false` so boot didn't burn the only attempt. `extensions sync` printed
    one `✗` line per failed package with `reason: network` and the real `npm error code
    ECONNREFUSED` message, the `"these will be retried automatically on the next daemon start; run
    ...to retry now"` footer, and exited 1. A follow-up `extensions list` confirmed the daemon was
    still fully responsive (not crashed, not wedged) and reported all 5 entries as `failed` with
    the same reason/message, `attempts` accumulated correctly across the run in
    `extensions-state.json` (the one package that had also failed in an earlier aborted attempt
    against the same pi-home showed `attempts: 2`, the rest `attempts: 1` - proving `attempts` is a
    genuine cross-run counter, not reset per sync).

All 10 steps matched the spec's expected behavior exactly; no defects found in this final pass
(blockers 1 and 2, found during task 004/005 review, were already fixed and are exercised live by
steps 6-8 above).

### 3. Docs sweep

- **`AGENTS.md` (root)** - amended the `cli` -> `server`/`web-client` dependency sentence to name
  the extensions-list `--local` in-process read path as a third, narrower exception alongside the
  existing auth engine exception (both documented in full in `packages/cli/AGENTS.md`).
- **`packages/cli/AGENTS.md`** -
  - Added the `extensions` command group to the command-tree table (`list [--local]`, `select`,
    `sync`) with column-aligned formatting matching the surrounding table.
  - Documented `piHomeEnv()` (a separate, small implementation from the server's
    `resolvePiAgentDir`, since the CLI has no daemon config context when standalone) and the full
    zero-daemon-invocation exception for `extensions list --local`, cross-referencing
    `packages/server/AGENTS.md`'s `resolvePiAgentDir`/`effectivePiHomeKey` for the shared
    derivation contract those two independent implementations must agree on.
  - Added `extensions-commands.ts` to the CLI's own source-layout entry list.
- **`packages/server/AGENTS.md`** -
  - Added `extensions/wire.ts` (shared `DescribedEntry` -> wire-shape mapping used by both the list
    response and the set response, extracted during task 003 to eliminate a duplicate
    `toListFields` helper) and `extensions/extensions-rpc.ts` (the two RPC handlers) to the source
    layout table.
  - Updated the `extensions-service.ts` row to describe the task-003/004 refactor: constructor now
    takes `configPath` (needed to call the shared `persistExtensionPacks` config writer) and
    `spawn` (installer factory), `describe()` now sources `DescribedEntry`/`attachLastErrors` from
    `sync-planner.ts` directly instead of re-implementing them, and `setSelectedPacks` persists via
    `persistExtensionPacks` before running a selection-triggered sync.
  - Extended the "Preinstalled-extensions sync" narrative section with the RPC surface (`list`
    read-only, `set` optional `packs?` - present persists+syncs, absent is the ungated manual-sync
    trigger) and the CLI's `--local` exception.

All edits were applied as targeted line ranges (never a whole-file `oxfmt`/rewrite) to keep the
diff scoped to real content changes; `packages/protocol/AGENTS.md`'s two table-row insertions
(`extensionPacksListRequestSchema` family + `extensionPacks` in `SERVER_FEATURES`) were likewise
hand-inserted matching the file's existing unaligned-pipe table style, not machine-reformatted.

## Verification (this task + full sprint-057 + full repo gate)

- [x] Build: `npm run build` succeeds (clean, from `npm run clean`).
- [x] Typecheck: `npm run typecheck` succeeds (root `tsc -b`, no incremental cache).
- [x] Lint: `npx oxlint` clean on every file this task and sprint-057 touched (0 errors, 0
      warnings; pre-existing unrelated warnings elsewhere in the workspace, e.g.
      `web-client/theme/color-utils.ts`, are untouched and out of scope).
- [x] Format: `npx oxfmt --check` clean on every `.ts`/`.tsx` file touched by sprint-057. The four
      `AGENTS.md` files this task edited (root, `cli`, `server`, `protocol`) carry **pre-existing**
      markdown-table misalignment from before this sprint (confirmed via `git stash` - the
      baseline already has 59 files failing `npm run fmt:check`, all `.md`/`.json`/doc files, none
      of them a file this sprint's code changes touch); this task's edits to those four files were
      applied as targeted row insertions matching each file's existing (unaligned) table style, not
      whole-file reformats, so the diff is scoped to real content only. Per this project's stated
      convention ("unrelated pre-existing format issues are left untouched to maintain scope
      discipline"), fixing that repo-wide markdown-table debt is out of scope for sprint-057.
- [x] Tests: `npx vitest run` (full monorepo) - **149 test files, 1767 tests, all passing.**
- [x] Manual E2E: all 10 steps above, against real daemon binaries, real `pi`, real npm registry
      (including one deliberately unreachable), zero mocks.

## Notes

- No scope was narrowed. All acceptance criteria from the task file (the automated round-trip test
  against the real wire schema, and the manual verification script covering list/select/sync,
  removal-then-noop-sync, pin-then-noop-sync, pre-existing-install-adoption, `--local` parity,
  unknown-slug error handling, and hostile-network graceful degradation) were executed, not sampled.
- The manual E2E steps are not committed as an automated test (they require real network access to
  the live npm registry to install genuine packages, and a live `pi` binary) - this matches the
  task's own instruction to run them "against a real daemon (not `dev-bootstrap.ts`)" as a one-time
  closing gate, with the *automated* round-trip coverage living in `bootstrap.test.ts` instead.
- No new external dependencies. No unrelated files touched.
