# Task 006 — End-to-end verification across daemon + CLI, and the docs sweep

- **Sprint:** sprint-057-extensions-cli-rpc
- **Status:** done
- **Type:** test + docs
- **Area:** packages/cli, packages/server (integration); AGENTS.md (root, protocol, server, cli)
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-001, task-002, task-003, task-004, task-005

## Goal

Prove the whole feature works through the real surface a user touches — a live daemon plus the real
CLI — and leave every affected doc truthful.

## Context / why

Tasks 001–005 are each unit-tested against fakes. This task is the one that would catch a seam that
only breaks when the real pieces meet: an envelope the handler rejects, a status that renders as
`undefined`, a selection that persists to disk but not to the running daemon, a timeout that fires
anyway.

It closes the sprint the way sprint-056 closed: a recorded manual run, plus committed integration
coverage that stays offline.

## Scope references

- `swe/features/preinstalled-extensions.md` § Acceptance Criteria (the RPC/CLI subset), § CLI surface,
  § RPC surface
- Sprint-056's task-006 summary — the live-run recipe to extend (throwaway `$PI_STUDIO_HOME` +
  `--pi-home`)
- `packages/cli/src/cli-core.ts` — `withDaemon`, exit-code conventions
- Docs to modify: root `AGENTS.md` (protocol-overview RPC list, feature list),
  `packages/protocol/AGENTS.md` (the two pairs + `extensionPacks` feature flag),
  `packages/server/AGENTS.md` (the `extensions/` handler module + registration note),
  `packages/cli/AGENTS.md` (the `extensions` command group, `--local`, `--pi-home` interaction, exit
  codes)

## What to build

**1. Committed integration test** (offline): boot the real daemon in-process with an injected install
spawn seam and a temp `$PI_STUDIO_HOME`, then drive `extension_packs_list_request` →
`extension_packs_set_request` (with `packs`) → `extension_packs_set_request` (**without** `packs`, the
manual-sync path) → `extension_packs_list_request`. Use the **house idiom** from
`packages/server/src/daemon/bootstrap.test.ts` — raw `ws` sockets plus its local `rpc()` helper, not a
real `DaemonClient`: that file's comment at `:416-420` records why (a real `DaemonClient` silently
drops unrecognized frames, so asserting raw wire frames is the point), and pulling the client package
into a server test would add a workspace dev-dependency that does not exist today. The real
`DaemonClient` path is covered from the other side by task 004 and by the live run below. Asserts the
full round trip including a seeded failure. No real `pi`, no network.

**2. Live manual run**, recorded verbatim in the summary:

1. Fresh throwaway `$PI_STUDIO_HOME` + `--pi-home`; start the daemon.
2. `pi-studio extensions list` — five entries; after boot sync, statuses are `installed`.
3. `pi remove <one>` (real pi, same pi-home) → `pi-studio extensions list` shows `user_removed`.
4. `pi-studio extensions sync` → the removed one is **not** reinstalled; exit `0`, `noop`. Repeat with
   `PI_STUDIO_EXTENSIONS_AUTOSYNC=false` on the daemon to prove the manual path is ungated.
5. Hand-pin another entry in `settings.json` → `list` shows `user_modified`; `sync` leaves it alone.
6. Stop the daemon → `pi-studio --pi-home <dir> extensions list --local` prints the same table.
7. `pi-studio extensions select nope` → error message names the unknown slug, exit non-zero,
   `config.json` unchanged.
8. Break the network (or point npm at an unreachable registry), fresh pi-home, restart, then
   `pi-studio extensions sync` → per-failure lines + retry footer, exit non-zero, daemon still healthy.

**3. Docs sweep** — the four `AGENTS.md` files above. Specifically: the two RPC names in the root
protocol-overview list (they are flat snake_case, matching the documented dominant convention), the
`extensionPacks` feature flag, the server's `extensions/` module rows including which bootstrap
registers them, and the CLI's new group with its exit-code rules and the `--pi-home` root-option
gotcha. Verify task 005 already amended the root dependency-graph sentence for `--local`; if it chose
to drop `--local` instead, ensure no doc claims the flag exists.

## Out of scope

- New behavior of any kind. This task fixes only what the E2E run reveals; anything larger becomes a
  new task rather than silent scope growth here.
- Web UI for pack selection (later sprint).
- Committing any network-dependent test.

## Acceptance criteria

- [ ] Committed offline integration test drives list → set(with `packs`) → set(without `packs`) → list
      against an in-process daemon using the `bootstrap.test.ts` raw-socket idiom, including one seeded
      install failure surfacing as `status: "failed"` + `lastError` and `outcome: "partial"`.
- [ ] All eight live steps above are executed and their output recorded in the task summary.
- [ ] Steps 3–5 confirm the non-interference guarantee through the **real** CLI and a **real** `pi`,
      not fixtures — a `pi remove` and a hand-pin both survive a subsequent `sync`.
- [ ] Step 8 confirms a hostile network degrades to a reported `partial`/`failed` with a healthy
      daemon and an actionable message, never a crash or a hang.
- [ ] Root, protocol, server, and cli `AGENTS.md` are updated and accurate; no doc describes
      aspirational behavior (e.g. no `autoSync`-over-the-wire, no push message type, no `--local` for
      `select`/`sync`).
- [ ] Whole-repo gates green: `npm run build`, `npm run typecheck`, `npm run lint`,
      `npm run fmt:check`, `npm test`.
- [ ] Any deviation found between the spec and the shipped behavior is resolved by amending
      `swe/features/preinstalled-extensions.md` in this task, so the spec stays the truth.

## Test / verification plan

- Build: `npm run build`; Typecheck: `npm run typecheck`; Lint: `npm run lint`; Format:
  `npm run fmt:check`.
- Tests: create the integration test under `packages/server/src/extensions/` (or the existing WS
  integration test location, matching house placement); run `npm test` (full suite) as the sprint's
  closing gate.
- Manual: the eight-step run above, against a real daemon and a real bundled `pi`.

## Notes

- Run the live steps against throwaway directories only — never the developer's real `~/.pi` or
  `~/.pi-studio`.
- If step 2 shows `pending` rather than `installed`, boot sync did not run: check `autoSync` and that
  the production `bootstrap.ts` (not `dev-bootstrap.ts`) was used before assuming a handler bug.
- Sprint 058 candidate to note in the summary, not to build here: a web-client settings panel over
  `task-004`'s SDK methods.
