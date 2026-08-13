# Task 005 — CLI `pi-studio extensions` group: `list`, `select`, `sync` — Summary

- **Sprint:** sprint-057-extensions-cli-rpc
- **Completed:** 2026-08-13
- **Status:** done

## What was implemented

**`packages/cli/src/extensions-commands.ts`** — the `extensions` command group:
- `extensions list` — table (or `--json`) of curated packs/entries/statuses; failed entries show
  `reason`, a truncated first-line `message`, and `attempts` when > 1. Exit `0` always.
- `extensions select [packs...]` — replaces the selection (`core` always implicit; `[packs...]` is
  optional variadic so a bare `select` deselects down to core-only, a real, meaningful request), then
  syncs.
- `extensions sync` — triggers a sync with **no `packs` key** on the wire (task-001's optional-field
  contract) — the ungated manual path, works even with `daemon.extensions.autoSync: false`.
- Both `select`/`sync` use `withDaemon` + `client.request(type, params, EXTENSIONS_SYNC_TIMEOUT_MS)`
  directly (`EXTENSIONS_SYNC_TIMEOUT_MS = 600_000`) — never `runRpc`, which has no timeout slot.
- Exit codes: `ok`/`noop` ⇒ `0`; `partial`/`failed`/`skipped`, or `ok: false` ⇒ `EXIT_ERROR` — no
  carve-out for "expected" failures.
- Missing `serverFeatures.extensionPacks` ⇒ "this daemon does not support extension packs; update
  the host", `EXIT_ERROR`, **no request sent** (checked before every RPC).
- `extensions list --local` — daemon-free, mirroring the `auth` group: resolves the pi-home through
  the real `effectivePiHomeKey`/`loadConfig` derivation (never a hand-rolled path join), runs the
  same `planSync`/`attachLastErrors`, and renders through the **same** `renderExtensionsList`
  function the daemon path calls.

Pure, unit-tested helpers: `buildEntryRows`, `renderSyncReport`, `renderExtensionsList`,
`exitCodeForSetResponse` — none touch a client.

## The pi-home extraction + shared-module refactor (blocking prerequisite, spec-mandated)

The task spec (amended during pre-implementation review) required fixing a real coupling bug before
`--local` could exist: `extensions-state.ts` imported `resolvePiAgentDir` from
`agent/provider-registry.ts`, which also carries the real `PiAgentClient`/`MockAgentClient` provider
runtime — exactly what a pure-planning CLI path must never pull in.

- **`packages/server/src/agent/pi-home.ts`** (new) — `resolvePiAgentDir`/`piHomeEnv` moved here
  verbatim (a move, not a copy — single implementation). Dependency-light: only `node:path` +
  `files/resolve-path.ts`.
- **`provider-registry.ts`** — imports both from `pi-home.ts`; re-exports `resolvePiAgentDir` so its
  existing import surface (`provider-registry.test.ts`) needed zero changes.
- **`extensions-state.ts`** — imports `resolvePiAgentDir` from `pi-home.ts` directly, never through
  `provider-registry.ts`. Also gained `readPiSettingsPackages` (the settings.json reader, extracted
  from `ExtensionsService`'s private method — now shared by the daemon path and `--local`).
- **`sync-planner.ts`** — gained `DescribedEntry`/`attachLastErrors` (moved from `extensions-service.ts`,
  which now imports them) — the lastError-attachment glue, now reusable by `--local`.
- **`wire.ts`** (new) — `toExtensionPackInfoList` (the `DescribedEntry[]` → wire `ExtensionPackInfo[]`
  mapping, including the total `EntryStatus`→wire-string table) — moved out of `extensions-rpc.ts`
  into a pure module both the daemon RPC handler and the CLI's `--local` path import. This is what
  makes "the two paths cannot drift" a structural guarantee, not a hoped-for test property.
- **`extensions/index.ts`** (new) — public barrel for the pure planning surface (curated-packs,
  sync-planner, extensions-state, wire) — deliberately excludes `extensions-service.ts`/
  `sync-executor.ts` (orchestration, `child_process` spawning). Wired into `src/index.ts`, so
  `@av-pi-studio/server`'s package now actually exports these symbols at all (it didn't before).

`extensions-rpc.ts` and `extensions-service.ts` were updated to consume the moved/shared pieces;
zero behavior change — `extensions-rpc.test.ts` and `extensions-service.test.ts` (sprint-057/task-003
and sprint-056) pass unchanged.

## Documented-boundary changes

- **Root `AGENTS.md`** — amended the cli→server dependency sentence to name the new deliberate
  exception (`--local` importing `server`'s pure extension-planning modules), pointing to
  `packages/cli/AGENTS.md`'s Invariants section for the full rationale.
- **`packages/cli/AGENTS.md`** — added a third invariant bullet (alongside the pre-existing
  auth-engine exception) explaining precisely why this doesn't contradict "the CLI process never
  runs daemon/relay code in-process": the rule is about daemon lifecycle/mutation code, not every
  line ever exported from `@av-pi-studio/server`; `--local` never imports `ExtensionsService`/
  `sync-executor.ts`/anything under `daemon/`, and the `pi-home.ts` extraction keeps its import graph
  away from `providers/pi`/`providers/mock`. Also added the `extensions` group's command-tree
  section and source-layout row.
- **`packages/server/AGENTS.md`** — updated source layout (`pi-home.ts`, `wire.ts`,
  `extensions-rpc.ts`, `extensions/index.ts` rows; `provider-registry.ts`/`extensions-state.ts` rows
  corrected) and the "Extensions sync" narrative section (single-derivation bullet now points at
  `pi-home.ts`; new RPC-surface bullet documents `extensions-rpc.ts`'s two-branch `set` handling).

**Decision, not a drop:** `--local` was kept (not dropped) — the coupling is real but narrow and
precisely bounded, matching the existing auth-engine precedent for exactly this kind of exception.

## Files created / changed

| File | Change |
|------|--------|
| `packages/server/src/agent/pi-home.ts` | created — `resolvePiAgentDir`/`piHomeEnv` (moved) |
| `packages/server/src/agent/provider-registry.ts` | imports from `pi-home.ts`, re-exports `resolvePiAgentDir` |
| `packages/server/src/extensions/extensions-state.ts` | imports `pi-home.ts` directly; added `readPiSettingsPackages` |
| `packages/server/src/extensions/sync-planner.ts` | added `DescribedEntry`/`attachLastErrors` |
| `packages/server/src/extensions/wire.ts` | created — `toExtensionPackInfoList` (shared wire mapping) |
| `packages/server/src/extensions/extensions-service.ts` | consumes the shared helpers; no behavior change |
| `packages/server/src/extensions/extensions-rpc.ts` | consumes `wire.ts`; no behavior change |
| `packages/server/src/extensions/index.ts` | created — pure-planning-surface public barrel |
| `packages/server/src/index.ts` | re-exports `extensions/index.ts` |
| `packages/cli/src/extensions-commands.ts` | created — the `extensions` command group |
| `packages/cli/src/extensions-commands.test.ts` | created — 16 tests |
| `packages/cli/src/program.ts` | registers `registerExtensionsCommands` |
| `AGENTS.md` (root) | amended cli→server dependency sentence |
| `packages/cli/AGENTS.md` | new invariant bullet, `extensions` group docs, source-layout row |
| `packages/server/AGENTS.md` | source-layout + narrative updates (pi-home.ts, wire.ts, extensions-rpc.ts, index.ts) |

## Build & test results

```
$ npm run clean && npm run build   (whole workspace)
(success — all 8 packages)

$ npx oxfmt --check <every touched .ts file>
All matched files use the correct format.

$ npx oxlint <every touched .ts file>
(0 new warnings)

$ npm run typecheck   (whole workspace)
(success)

$ npx vitest run   (whole workspace)
Test Files  149 passed (149)
     Tests  1766 passed (1766)
   [extensions-commands.test.ts: 16 new; provider-registry.test.ts: 11 passed unchanged;
    extensions-service.test.ts: 12 passed unchanged; extensions-rpc.test.ts: 10 passed unchanged]
```

## Manual verification (real daemon, real `pi install`, network-enabled sandbox)

```
$ pi-studio -H 127.0.0.1:6799 extensions list
PACK  SOURCE  ...  STATUS   ...
core  ...pending (x5)
exit: 0

$ pi-studio --json -H 127.0.0.1:6799 extensions list
{ "type": "extension_packs_list_response", "autoSync": false, "selected": [], "packs": [...] }
exit: 0

$ pi-studio -H 127.0.0.1:6799 extensions select        # autoSync:false + packs ⇒ gated, installs nothing
installed 0 of 0 recommended extensions
exit: 0

$ pi-studio -H 127.0.0.1:6799 extensions sync           # ungated manual path — real pi install, network
installed 5 of 5 recommended extensions
exit: 0

$ pi-studio -H 127.0.0.1:6799 extensions list           # after sync — all installed for real
PACK  SOURCE  ...  STATUS
core  ...installed (x5)
exit: 0
# settings.json on disk genuinely contains all 5 packages

$ (daemon stopped) pi-studio --home <home> --pi-home <home>/pihome extensions list --local
PACK  SOURCE  ...  STATUS
core  ...installed (x5)          # byte-identical table to the daemon path above
exit: 0

$ pi-studio -H 127.0.0.1:6799 extensions select nope
unknown pack: nope
exit: 1
```

## Acceptance criteria

- [x] `extensions list` renders a table with one row per curated entry, showing each of the six
      statuses correctly against a fake daemon response; a `failed` row shows reason, truncated
      message, and `attempts` when > 1; `--json` emits the raw payload.
- [x] `select core` sends `extension_packs_set_request` with `packs` and a `timeoutMs` of 600 000.
- [x] `extensions sync` sends `extension_packs_set_request` without `packs` (same 600 000 timeout)
      and never writes the selection.
- [x] Report output: an `ok` sync prints the installed count; a `partial` sync prints one line per
      failure with source, pack, reason, and message-first-line, plus the retry footer.
- [x] Exit codes: `ok` ⇒ 0, `noop` ⇒ 0, `partial`/`failed`/`skipped` ⇒ `EXIT_ERROR`.
- [x] `ok: false` (unknown slug) ⇒ the daemon's `error` is printed and exit is `EXIT_ERROR`; no
      success/installed line is printed.
- [x] Missing `extensionPacks` server feature ⇒ actionable "update the host" message, `EXIT_ERROR`,
      no request attempted.
- [x] `extensions list --local` works with no daemon running, honours `--pi-home <dir>`, prints the
      same table, and writes nothing (asserted: settings.json byte-identical; no `extensions-state.json`
      created).
- [x] `--local` output equals `renderExtensionsList(payload)` — the exact function the daemon path
      calls — for an equivalent payload; the shared `wire.ts` mapping makes drift structurally
      impossible, not just test-verified.
- [x] The pi-home derivation is extracted into a leaf module with no provider-runtime imports;
      `provider-registry.ts`/`extensions-state.ts` both consume it (moved, not copied — existing
      `provider-registry.test.ts` path-parity tests pass unchanged); the CLI's `--local` import graph
      never reaches `providers/pi`/`providers/mock` directly (documented nuance: the CLI process as a
      whole already loads that module graph today via `daemon-commands.ts`'s pre-existing
      `@av-pi-studio/server` import and `program.ts`'s eager command-group registration — a
      pre-existing, unrelated architectural fact, not something this task caused or could fix without
      a much larger lazy-loading restructure; see `packages/cli/AGENTS.md`'s Invariants section).
- [x] Root `AGENTS.md`'s cli→server dependency sentence amended.
- [x] `pi-studio extensions --help` lists all three subcommands; registered in `program.ts`.

## Follow-ups / TODO(verify)

- None. Task 006 (E2E verification + docs sweep) closes out the sprint.
