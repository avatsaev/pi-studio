# Task 005 — CLI `pi-studio extensions` group: `list`, `select`, `sync`

- **Sprint:** sprint-057-extensions-cli-rpc
- **Status:** done
- **Type:** feature
- **Area:** packages/cli
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** task-001, task-003

## Goal

Ship the human surface: see what is recommended and what state each entry is in, change the selection,
and retry failures now — with exit codes a provisioning script can trust.

## Context / why

Everything before this task is machinery. This is where a user discovers the feature exists.

Three details are load-bearing and were settled during spec review:

1. **`select`/`sync` need a generous per-call timeout.** The set response arrives only after the
   daemon's sync completes; a first-run install of five packages can easily exceed the SDK's default
   30 s `rpcTimeoutMs`. Without this, the flagship first-run command prints "request timed out" *while
   the installs are succeeding in the background* — the worst possible first impression, and a
   misleading one.
2. **Exit codes are simple by design.** `0` on `ok`/`noop`, `EXIT_ERROR` otherwise (`partial`,
   `failed`, `skipped`) — and successful installs are always kept and reported regardless. The earlier
   draft had a carve-out that returned `0` for "expected" failures; it was removed with the private
   package that motivated it. No special cases now.
3. **Every failure prints its own line.** A count is not enough: a user needs to know *which* package
   failed and why, and that it will be retried automatically.

`--local` mode (see below) lets `extensions list` work with **no daemon running**, mirroring how the
`auth` group operates entirely CLI-locally.

## Scope references

- `swe/features/preinstalled-extensions.md` § CLI surface (all three subcommands, the report format,
  the exit-code rules, `--json`, `--local`), § RPC surface (the timeout note)
- `packages/cli/src/program.ts` — command-group registration, root options incl. `--pi-home`
  (positional-options mode: root options precede the subcommand)
- `packages/cli/src/cli-core.ts:86-150` — `runRpc` (**no** timeout slot), `withDaemon`, `formatOf`,
  `EXIT_ERROR`, JSON-vs-table output conventions
- `packages/cli/src/auth-commands.ts` + `auth-runtime.ts` — the daemon-free group precedent for
  `--local`, including how `--pi-home` is resolved CLI-side
- `packages/cli/src/agent-commands.ts` — table/`--json` rendering style to match
- `packages/server/src/extensions/{curated-packs,sync-planner,extensions-state}.ts` — imported by
  `--local` (sprint-056/tasks 002-004), including `effectivePiHomeKey` so `--local` reuses the **same**
  pi-home derivation as the daemon rather than hand-rolling a `<dir>/agent` join
- Create: `packages/cli/src/extensions-commands.ts` (+ `.test.ts`)
- Modify: `packages/cli/src/program.ts`

## What to build

**`pi-studio extensions list`** — table: pack, source, status, and for `failed` the reason, the
truncated first line of the message, and `attempts` when > 1 (spec § CLI commands). `--json` emits the
raw response. Exit `0` always (reporting, not acting).

**`pi-studio extensions select <packs...>`** — replaces the selection (`core` always implicit), then
syncs. Prints `installed N of M recommended extensions`, then one line per failure
(`✗ <source> (<pack>): <reason> — <first line of message>`), then the retry footer: *these will be
retried automatically on the next daemon start; run `pi-studio extensions sync` to retry now*.

**`pi-studio extensions sync`** — triggers a sync without changing the selection: sends
`extension_packs_set_request` **with no `packs` field** (task 001's optional-field contract), which the
daemon routes to the ungated `sync("manual")` path. Same report output and exit rules as `select`.
Works with `autoSync: false` — that is the whole point of the ungated path.

Shared behavior:

- `select`/`sync` use `withDaemon` + `client.request(type, params, EXTENSIONS_SYNC_TIMEOUT_MS)` with
  `EXTENSIONS_SYNC_TIMEOUT_MS = 600_000` — **not** `runRpc`, whose signature has no timeout slot. Do
  not widen `runRpc` for this one caller.
- Exit `0` on `ok`/`noop`; `EXIT_ERROR` on `partial`/`failed`/`skipped`.
- `ok: false` (unknown slug) ⇒ print the daemon's `error` and exit `EXIT_ERROR` without pretending a
  sync happened.
- `--json` on every subcommand, using `formatOf` like its siblings.
- A daemon lacking `serverFeatures.extensionPacks` ⇒ "this daemon does not support extension packs;
  update the host", exit `EXIT_ERROR`.

**`--local` (list only)** — run the planner in-process against the effective pi-home, no daemon: read
the manifest, `extensions-state.json`, and pi's `settings.json`, call `planSync`, print the same table.
Resolves the pi-home through the shared `effectivePiHomeKey`/`resolvePiAgentDir` derivation (honouring
the root `--pi-home` and the `agents.providers.pi.env` override), **not** a local path join — a fourth
parallel derivation is exactly what sprint-056 eliminated. Read-only: it never installs and never
writes state.

> **Documented-boundary change.** Root `AGENTS.md` currently states that `cli` depends on `server`
> *not* to import its runtime code, only to resolve module URLs for spawning. `--local` imports three
> pure server modules (manifest, planner, state reader), which contradicts that sentence. Amend the
> root `AGENTS.md` dependency-graph note **in this task** (the docs-sync rule), narrowly: cli imports
> `server`'s pure extension-planning modules for `extensions list --local`. If that coupling is
> unwanted, the alternative is dropping `--local` — decide and record the choice in the task summary;
> do not leave the invariant contradicted.

## Out of scope

- Protocol, handlers, SDK (tasks 001–004); the docs sweep for protocol/cli AGENTS.md details (task 006
  — except the root dependency-graph sentence above, which this task must not leave stale).
- Any interactive picker. `select` takes positional slugs; `@inquirer/prompts` stays an `auth`-only
  dependency.
- Making `autoSync` settable from the CLI (file/env kill switch only in v1).
- `--local` for `select`/`sync` — installing without a daemon is explicitly not in scope.

## Acceptance criteria

- [ ] `extensions list` renders a table with one row per curated entry, showing each of the six
      statuses correctly against a fake daemon response; a `failed` row shows reason, truncated
      message, and `attempts` when > 1; `--json` emits the raw payload.
- [ ] `select core` sends `extension_packs_set_request` **with** `packs` and the request carries a
      `timeoutMs` of 600 000 (asserted on a fake client, not by waiting).
- [ ] `extensions sync` sends `extension_packs_set_request` **without** `packs` (same 600 000 timeout)
      and never writes the selection.
- [ ] Report output: an `ok` sync prints the installed count; a `partial` sync prints **one line per
      failure** with source, pack, reason, and message-first-line, plus the retry footer.
- [ ] Exit codes: `ok` ⇒ 0, `noop` ⇒ 0, `partial` ⇒ `EXIT_ERROR`, `failed` ⇒ `EXIT_ERROR`,
      `skipped` ⇒ `EXIT_ERROR`.
- [ ] `ok: false` (unknown slug) ⇒ the daemon's `error` is printed and exit is `EXIT_ERROR`; no
      success/installed line is printed.
- [ ] Missing `extensionPacks` server feature ⇒ actionable "update the host" message, `EXIT_ERROR`,
      no request attempted.
- [ ] `extensions list --local` works with **no daemon running**, honours `--pi-home <dir>` (resolving
      to `<dir>/agent/settings.json` via the shared derivation), prints the same table, and writes
      nothing (asserted: state file and settings file byte-identical afterwards).
- [ ] `--local` output for a given fixture state matches the daemon-path output for the same state —
      the two must not drift.
- [ ] Root `AGENTS.md`'s cli→server dependency sentence is amended (or `--local` dropped, with the
      decision recorded in the summary).
- [ ] `pi-studio extensions --help` lists all three subcommands; the group is registered in
      `program.ts` alongside its siblings.

## Test / verification plan

- Build: `npm run build` succeeds (cli builds last, so this catches cross-package breakage).
- Typecheck: `npm run typecheck` succeeds.
- Lint/format: `npx oxlint <changed files>`, `npx oxfmt --check <changed files>` clean.
- Tests: create `packages/cli/src/extensions-commands.test.ts` following the fake-client / captured-
  stdout idiom used by the other command tests; run `npx vitest run packages/cli`.
- Manual: against a real daemon — `pi-studio extensions list`, `… select core`, `… sync`, and
  `pi-studio --pi-home <tmp> extensions list --local` with the daemon stopped. Record output in the
  summary.

## Notes

- Keep rendering logic in a pure exported helper (e.g. `renderSyncReport(report): string[]`) so it is
  unit-testable without a client — this repo's convention is pure logic in `.ts` modules, thin
  command wiring around it.
- `--pi-home` is a **root** option (Commander `enablePositionalOptions()`), so it must precede the
  subcommand: `pi-studio --pi-home <dir> extensions list --local`. Say so in the help text to save
  users the discovery.
- Do not add a `--yes`/confirmation prompt: `select` is explicit by construction.
