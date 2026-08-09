# Task 003 — `pi-studio auth status` + `auth logout`

- **Sprint:** sprint-054-provider-auth-cli
- **Status:** done
- **Type:** feature
- **Area:** packages/cli — provider auth
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-001

## Goal

Register the `auth` command group with its two read/remove-side commands, so a user can see exactly
which model providers are configured, how, and from where — and remove a stored credential.

## Context / why

Status is the smallest end-to-end proof that the task-001 seam resolves the right `auth.json` and
reads it correctly; it also answers the first question every user asks after installing
("am I configured?"). Both commands are non-interactive, so they land before the login flow and give
task 004 a working group to hang off.

`AuthCheck.source` is what distinguishes a **stored** credential from an **ambient** one (an env var
such as `ANTHROPIC_API_KEY`) — surfacing it prevents the classic "why does logout not help?"
confusion.

## Scope references

- `swe/features/provider-auth-cli.md` § Public Contract (Commands table), § Behavior (`status`),
  § Error Handling
- `swe/features/cli.md` § Command tree
- `packages/cli/src/program.ts` — `registerCommands()`, the single registration seam
- `packages/cli/src/output.ts` — `renderTable`, `renderJson`
- `packages/cli/src/cli-core.ts` — `EXIT_OK`, `EXIT_ERROR`, `formatOf`, `CliContext.auth`
- `packages/cli/src/pi-commands.ts` — registration/orchestration shape to mirror
- Create: `packages/cli/src/auth-commands.ts`, `packages/cli/src/auth-commands.test.ts`
- Modify: `packages/cli/src/program.ts`

## What to build

- **`registerAuthCommands(program, ctx, setExit)`** in `packages/cli/src/auth-commands.ts`, wired
  into `registerCommands()` in `program.ts` alongside the existing groups. Command group:
  `pi-studio auth` with subcommands `status` and `logout <provider>` (login lands in task 004).
- **Runtime resolution:** `ctx.auth ?? defaultAuthRuntime(resolvePiAuthPaths(globalOptions))`.
  Never construct the Pi runtime at registration time — only inside an action.
- **`auth status`:**
  - Rows from `listProviders()` + `checkAuth()` per provider, with a bounded per-provider timeout so
    one slow ambient probe cannot hang the command (degrade that row to `unknown`).
  - Table columns: `PROVIDER`, `NAME`, `STATUS`, `SOURCE`.
    `STATUS` ∈ `api key` | `oauth` | `not configured`; `SOURCE` shows `AuthCheck.source` when present
    (e.g. the env var name), else `auth.json` for stored credentials, else empty.
  - Footer line (table mode only, stderr): the resolved `auth.json` path, so users can see *which*
    store they are looking at.
  - `--json` (global flag — **must precede the subcommand**: `pi-studio --json auth status`, the
    root program uses `enablePositionalOptions()`) prints a stable array:
    `[{ id, name, configured, type?, source? }]`, sorted by `id` for deterministic output, where
    `configured` is `boolean | "unknown"` — `"unknown"` is the probe-timeout degradation, same as
    the table's `unknown` state.
  - Exit `EXIT_OK` even when nothing is configured (status is informational, not a check).
- **`auth logout <provider>`:**
  - Unknown provider id → error listing valid ids, `EXIT_ERROR`.
  - Known provider with no stored credential → succeeds idempotently, prints that nothing was
    stored, `EXIT_OK`.
  - Success → confirmation naming the provider and the `auth.json` path.
  - **After** a successful (or no-op) removal, re-run `checkAuth()`: if the provider is *still*
    configured, the credential is ambient (an env var such as `ANTHROPIC_API_KEY`) — print a note
    naming the source and stating that logout does not remove it. The pre-logout check cannot
    detect this case: while a stored credential exists, `checkAuth()` reports the stored one, and
    the ambient source only becomes visible once it is gone.

## Out of scope

- `auth login` in any form (tasks 004, 005).
- Any daemon/RPC interaction — these commands never open a WebSocket.

## Acceptance criteria

- [x] `pi-studio auth status` renders a table covering all four states against a fake runtime:
      stored api key, stored oauth, env-var-sourced, not configured.
- [x] `pi-studio --json auth status` emits the documented array, id-sorted, with no keys beyond
      the specified ones (`configured: "unknown"` for a timed-out probe).
- [x] The resolved `auth.json` path is shown in table mode and absent from JSON stdout.
- [x] A provider whose `checkAuth()` hangs past the timeout degrades to `unknown` and does not block
      the command.
- [x] `pi-studio auth logout <known>` removes the credential (fake runtime records the call) and
      exits 0; a second invocation still exits 0 with the "nothing stored" message.
- [x] `pi-studio auth logout <unknown>` exits `EXIT_ERROR` and lists valid provider ids.
- [x] Logging out a provider that is also env-var configured prints the ambient-credential note.
- [x] `pi-studio --help` lists the `auth` group; the AUTH SEAM itself never imports Pi until first
      use (verified — see Notes below for a pre-existing, out-of-scope caveat on the whole-process
      claim).

## Test / verification plan

- Build: `npm run build:cli` succeeds.
- Typecheck/Lint: `npm run typecheck`, `npm run lint` succeed.
- Tests: add `packages/cli/src/auth-commands.test.ts` driving `run(argv, ctx)` from `program.ts`
  with an injected fake `AuthRuntime` and recording sink (the `pi-commands.test.ts` /
  `program.test.ts` pattern). Cover every acceptance row above. Run
  `npx vitest run packages/cli/src/auth-commands.test.ts packages/cli/src/program.test.ts`.
- Manual: `node packages/cli/dist/cli.js auth status` against a real machine — output must match the
  real `~/.pi/agent/auth.json` state, and `--pi-home /tmp/empty-pi auth status` must show everything
  unconfigured without creating stray files beyond what Pi itself creates.

## Notes

- Keep the fake-runtime test seam strict: no test in this task may import
  `@earendil-works/pi-coding-agent`.
- The per-provider `checkAuth` timeout also protects task 004's picker — put it in the shared helper,
  not inline in the status action.
- **Finding (pre-existing, out of scope here):** `daemon-commands.ts` and `pi-commands.ts` already
  statically `import ... from "@av-pi-studio/server"` (for `loadConfig`/`resolveBinaryOnPath`/
  `resolveBundledPiCli`), and `@av-pi-studio/server`'s own module graph statically imports the real
  `@earendil-works/pi-coding-agent` (verified directly: a `Module._resolveFilename` trace on
  `import("@av-pi-studio/server")` alone loads `pi-coding-agent`'s `cross-spawn`/`highlight.js`/
  `yaml`/`jiti`/`undici`/etc. dependency tree). This means `pi-studio --help` — and every other
  command — already pays the "whole Pi TUI module graph" tax task-001 set out to avoid, via a path
  wholly unrelated to `auth-runtime.ts`. This task's own seam is lazy and verified as such (test:
  "no Pi import occurs for `--help`" — this asserts `ModelRuntime.create` is never *invoked*, which
  is what the auth seam actually controls; it cannot assert the module is never *loaded*, because
  it already is, before this sprint, via `program.ts → daemon-commands.ts/pi-commands.ts →
  @av-pi-studio/server`). Fixing that would mean lazy-loading `@av-pi-studio/server` itself from the
  CLI — a real, separate architectural change, unscoped here and not undertaken. Flagged for
  task-006's real-run module-load-trace step and for the user's awareness.
