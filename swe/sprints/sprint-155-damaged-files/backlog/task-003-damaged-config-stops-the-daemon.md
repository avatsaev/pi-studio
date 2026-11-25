# Task 003 — A damaged `config.json` stops the daemon and is never overwritten

- **Sprint:** sprints/sprint-155-damaged-files
- **Status:** backlog
- **Type:** bugfix
- **Area:** packages/server (config, bootstrap), packages/cli (daemon control and commands)
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** task-001, sprint-154/task-004, sprint-153/task-005

## Goal
A daemon never starts without its password because the config file was damaged, and no command
replaces a damaged config with a near-empty one.

## Context / why
Finding S5, wider than the audit said. `loadConfig` turns a parse error into `{}`: the daemon starts
with no password and the default address. Four writers read the same way and write back:
`persistExtensionPacks` and `persistUpdateAutoCheck` in the server, `setDaemonPassword` and
`persistRelayEnvOverrides` in the CLI (those two not even atomically), so `daemon set-password` on a
damaged file replaces it with just the password hash. A schema failure already throws, but it is not
logged and `onFatalError` is not called: under a detached start the CLI prints `not_healthy` after 6 s.

## Scope references
- `docs/daemon-audit-handoff.md` § "M5 choices" (damaged files), § S5
- `packages/server/src/config/daemon-config.ts` (`loadConfig` :188-208, `persistExtensionPacks`
  :221-249, `persistUpdateAutoCheck` :257-281), `daemon-config.test.ts` (:240 asserts the destructive
  behaviour and must be reversed)
- `packages/server/src/daemon/bootstrap.ts` (`loadConfig` at :286 and :486), `daemon/loopback.ts` and
  `listen.test.ts` :128 (the `unprotected_bind` refusal is the model: log, `process.exitCode = 1`,
  `onFatalError`, before the PID file and any service)
- `packages/cli/src/daemon-control.ts` (`setDaemonPassword` :205-224, `persistRelayEnvOverrides`
  :286-314), `daemon-commands.ts` (`resolvePairing` :77, the pre-check :140-160),
  `extensions-commands.ts` (:161), `daemon-commands.test.ts` (:451)

## What to build
- `loadConfig`: a file that exists and does not parse, or fails the schema, throws one typed error
  with code `config_unreadable` and a message that names the path and what is wrong. A missing file is
  still an empty config.
- **Start.** The daemon logs the error, sets the exit code, calls `onFatalError` and never listens.
- **Writers.** All four refuse to write when the existing file cannot be read, and leave it
  byte-identical. The two CLI writers become atomic with mode 0600 through one shared helper. A request
  that ends in such a write (`daemon_update_set_auto_check_request`, `extension_packs_set_request`)
  answers a domain error, not a crash.
- **CLI.** `daemon start`, `restart`, `pair`, `set-password` and `extensions list --local` print the
  message and exit non-zero; with `--json`, `{up: false, host, port, error: "config_unreadable"}`. The
  check runs before a daemon is spawned.

## Out of scope
The desktop app's wording (task-005).

## Acceptance criteria
- [ ] A truncated config: the start is refused and logged, nothing listens, no PID file, the file's
      bytes are unchanged.
- [ ] Each of the four writers leaves a damaged file byte-identical and reports the error.
- [ ] `pi-studio --json daemon start` prints one line with `config_unreadable` and exits non-zero.
- [ ] A valid config and a missing config behave as before.

## Test / verification plan
- `npx vitest run packages/server/src/config packages/server/src/daemon packages/cli`
- `npm run build:server && npm run build:cli`
