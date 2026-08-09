# Task 006 — Live end-to-end proof (CLI → daemon-spawned agent) + docs sync

- **Sprint:** sprint-054-provider-auth-cli
- **Status:** done
- **Type:** test + docs
- **Area:** packages/cli — provider auth; repo docs
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-001, task-002, task-003, task-004, task-005

## Goal

Prove the sprint's actual promise with real software — a credential created by `pi-studio auth
login` makes a **daemon-spawned agent run** — and bring every affected doc in line with what shipped.

## Context / why

Every earlier task is verified against fakes. The one claim that fakes cannot establish is the whole
point of the sprint: that the CLI writes to the *same* `auth.json` the daemon's `pi --mode rpc`
subprocesses read, under the same `piHome` resolution. That requires a real login, a real daemon,
and a real agent turn.

The docs surface also has one statement this sprint invalidates: `packages/cli/AGENTS.md`
§ Invariants says "**The CLI process never runs daemon/relay code in-process**". Still true as
written (Pi is neither daemon nor relay), but the CLI now runs **Pi's auth engine** in-process for
the `auth` group — a genuinely new class of in-process work that the invariant section must state
rather than leave a reader to discover.

## Scope references

- `swe/features/provider-auth-cli.md` § Acceptance Criteria (all rows), § TODO(verify)
- `swe/features/cli.md` § Command tree (add the `auth` group)
- `packages/cli/AGENTS.md` — Source layout, Global options, Command tree, Invariants, Testing
- `AGENTS.md` (root) — daemon configuration / onboarding context for `PI_STUDIO_PI_HOME`
- `packages/server/src/agent/provider-registry.ts` — the `piHomeEnv()` parity being proven
- Modify: `packages/cli/AGENTS.md`, root `AGENTS.md`, `swe/features/cli.md`,
  `swe/features/provider-auth-cli.md` (resolve TODO(verify) items)

## What to build

**A. Live verification run** (record every command + result in the task summary). Ordering note
for every command below: `--pi-home`/`--json` are **root** options and the root program uses
`enablePositionalOptions()`, so they must precede the subcommand
(`pi-studio --pi-home X daemon start`, never `pi-studio daemon start --pi-home X`):

1. Fresh store: `export PI_HOME_TEST=/tmp/pi-auth-e2e` (empty dir).
2. `pi-studio --pi-home $PI_HOME_TEST auth status` → all providers unconfigured, no crash on a
   store that does not exist yet.
3. `pi-studio --pi-home $PI_HOME_TEST auth login <api-key provider>` → interactive secret entry →
   success. Verify `$PI_HOME_TEST/agent/auth.json` exists, mode `0600`.
4. `pi-studio --pi-home $PI_HOME_TEST auth status` → provider shows configured, source `auth.json`.
5. **The proof:** start a daemon with the same pi home
   (`pi-studio --pi-home $PI_HOME_TEST daemon start`), then run an agent turn:
   `pi-studio run --provider pi/<model> "say hello"` — the agent provider is always `pi`; pick a
   `<model>` belonging to the vendor just authenticated in step 3, since the model selects which
   credential the spawned `pi --mode rpc` process uses. Confirm the turn completes — i.e. the agent
   authenticated with the credential the CLI wrote. Stop the daemon.
6. `pi-studio --pi-home $PI_HOME_TEST auth logout <p>` → `auth status` shows unconfigured.
7. Ambient credential: with `<PROVIDER>_API_KEY` exported and no stored credential,
   `auth status` reports the env-var source; `auth logout` prints the ambient note.
8. Headless: `pi-studio --pi-home $PI_HOME_TEST auth login <p> --api-key <key> < /dev/null` succeeds;
   `echo | pi-studio auth login` fails fast.
9. OAuth (if a subscription account is available): `auth login <oauth provider>` renders URL + QR,
   completes via browser, and `auth status` shows `oauth`. If no account is available, record it as
   not-exercised rather than claiming it passed.
10. Cold-start cost: confirm `pi-studio --help` and `pi-studio ls` do not load
    `@earendil-works/pi-coding-agent` (e.g. `node --experimental-loader` trace, `NODE_DEBUG` module
    trace, or a `require`/import spy in a scratch run) — the lazy-import guarantee, observed rather
    than asserted.

**B. Docs sync** (only what actually changed):

- `packages/cli/AGENTS.md`:
  - **Source layout** — add `auth-commands.ts`, `auth-runtime.ts`, `auth-interaction.ts` + their
    tests, one line each.
  - **Command tree** — new `### auth group (auth-commands.ts)` section: `login [provider]
    [--type] [--api-key]`, `status`, `logout <provider>`; state plainly that these commands are
    **local and daemon-free** (no RPC column, unlike every other group).
  - **Global options** — extend the `--pi-home` row: it now also selects the `auth.json` the `auth`
    group reads/writes.
  - **`CliContext`** — document the new `auth?: AuthRuntime` slot alongside `pi`/`daemon`/`relay`/
    `update`.
  - **Invariants** — amend precisely: the CLI still never runs daemon/relay code in-process, and now
    additionally loads Pi's `ModelRuntime` **in-process, lazily, for the `auth` group only**, writing
    Pi's own `auth.json` under Pi's file lock.
  - **Testing** — name the three new test files.
- Root `AGENTS.md`: mention `pi-studio auth login` where provider credentials/onboarding are
  discussed, and note that it targets the same `PI_STUDIO_PI_HOME`-derived tree as the daemon.
  **Pre-existing doc bug found during planning, verify live and fix here:** the `PI_STUDIO_PI_HOME`
  row documents `pi-studio daemon start --pi-home <dir>`, but `daemon start` declares no options of
  its own (`daemon-commands.ts` reads `piHome` from root globals) and the root program uses
  `enablePositionalOptions()` — the documented form is rejected; the working form is
  `pi-studio --pi-home <dir> daemon start`. Correct every occurrence (root `AGENTS.md` and the
  `--pi-home` row in `packages/cli/AGENTS.md` § Global options if it repeats the claim).
- `swe/features/cli.md`: add the `auth` group to the command tree table.
- `swe/features/provider-auth-cli.md`: resolve or update the three `TODO(verify)` items with what the
  live run found (fresh-machine `models.json` tolerance, localhost callback port behavior, the real
  provider id list used by the picker).

## Out of scope

- Any behavior change. If the live run uncovers a defect, fix it in this task **only** if it is a
  one-line correction; anything larger becomes a new task in this sprint's backlog and is called out
  in the summary.
- Daemon-side or web-client auth (scopes `provider-auth-rpc.md` / `provider-auth-ui.md`).

## Acceptance criteria

- [x] Every step in A is executed and its actual output recorded in the summary; step 5 shows a
      completed agent turn using the CLI-written credential. **All steps 1–10 executed and
      recorded live**, including step 5: `auth login moonshotai --api-key <user-supplied real
      key>`, `daemon start` on the same `--pi-home`, `run --provider pi/kimi-k2-0711-preview "say
      hello in exactly 3 words"` completed with a genuine model response ("Hello to you."),
      confirmed via `turn_completed` in the timeline.
- [x] `auth.json` created by the CLI has mode `0600`. Confirmed for both the eagerly-created empty
      store (Pi's own `FileAuthStorageBackend`, observed on a bare `auth status` against a
      nonexistent path) and after a real login.
- [~] Step 10 shows no `pi-coding-agent` load for `--help` / `ls`. **As literally worded, false —
      and pre-existing, unrelated to this sprint**: `daemon-commands.ts`'s static
      `@av-pi-studio/server` import transitively loads `@earendil-works/pi-coding-agent` for every
      CLI invocation (confirmed with a real `node:module` resolve/load hook trace, correcting
      task-003's less precise `Module._resolveFilename` claim). The guarantee this sprint actually
      owns and keeps true — `ModelRuntime.create()` is never invoked outside an `auth` command —
      **is** confirmed live (direct instrumentation of the installed `ModelRuntime.create`: zero
      calls for `--help`/`ls`, exactly one for `auth status`). See summary for full detail; docs
      corrected to state the precise claim, not the broader false one.
- [x] Step 9 is either passed with evidence or explicitly recorded as not exercised (no unverified
      claim). Recorded not-exercised — no real subscription account available; not attempted.
- [x] All doc edits in B are applied, and no doc states behavior that did not ship.
- [x] The `packages/cli/AGENTS.md` invariant now describes the in-process Pi auth runtime
      accurately (including the pre-existing eager-module-load nuance above).
- [x] Full gates green: `npm run build`, `npm run typecheck`, `npm run lint`, `npm test`.

## Test / verification plan

- Build: `npm run build` (full, dependency order).
- Typecheck: `npm run typecheck`. Lint: `npm run lint`. Format: `npx oxfmt <changed files>`.
- Tests: `npm test` (full suite) — no regressions; the three new test files pass.
- Manual: the ten-step live run above, verbatim commands and outputs captured in
  `done/task-006-e2e-verification-and-docs-summary.md`.

## Notes

- Use a throwaway `--pi-home` for the whole run so a developer's real `~/.pi` is never touched, and
  delete it afterwards.
- Never paste a real API key or OAuth token into the summary — record redacted evidence
  (`sk-…`, file mode, status output) only.
