# Task 003 — A damaged `config.json` stops the daemon and is never overwritten — Summary

- **Sprint:** sprints/sprint-155-damaged-files
- **Completed:** 2026-11-25
- **Status:** done

## What was implemented
`loadConfig` throws `ConfigUnreadableError` (code `config_unreadable`, message names the path and the problem) for a `config.json` that exists but cannot be read, is not JSON, is not an object or fails the schema; a missing file is still an empty config. `startDaemon` loads the config first (`loadConfigOrRefuse`): on that error it logs, sets `process.exitCode = 1`, calls `onFatalError` and throws, before the PID file, any service or any listen. `persistExtensionPacks` and `persistUpdateAutoCheck` share `updateRawConfig` and refuse without writing (`extension_packs_set_request` restores the previous selection and answers `{ok:false, error}`; `daemon_update_set_auto_check_request` answers `rpc_error` naming the file). The CLI writers (`setDaemonPassword`, `persistRelayEnvOverrides`) share `updateConfigFile` and a new atomic `writeConfigFile` (temp file 0600, fsync, rename). `reportingConfigErrors` wraps start, restart, onboard, `daemon pair`, `set-password` and `extensions list --local` (restart checks before it stops the daemon): text mode prints the message on stderr, `--json` prints one `{up:false, host, port, error:"config_unreadable"}` line, exit 1.

## Files changed
`config/daemon-config.ts`, `daemon/bootstrap.ts`, `extensions/{extensions-service,extensions-rpc}.ts`, CLI `daemon-control.ts`, `daemon-commands.ts`, `extensions-commands.ts`; tests (`config/daemon-config.test.ts`, new `daemon/config-refusal.test.ts`, `extensions-rpc.test.ts`, `update-rpc.test.ts`, `daemon-commands.test.ts`); docs: server and CLI `AGENTS.md`, `packages/cli/README.md`, `fern/pages/cli/daemon-and-auth.mdx`, root `AGENTS.md`.

## Build & test results
```
npx vitest run config, daemon, update, extensions, packages/cli -> 77 files, 1303 passed; build:server and build:cli OK; oxfmt/oxlint clean
Full-tree gate: build, typecheck 0 errors; lint 0 errors; npm test (three runs) 349 files, 5087 tests passed
```

## Acceptance criteria
- [x] A truncated config: start refused and logged, nothing listens, no PID file, bytes unchanged
- [x] Each of the four writers leaves a damaged file byte-identical and reports the error
- [x] `--json daemon start` prints one `config_unreadable` line and exits non-zero (also restart, pair, set-password, extensions list --local)
- [x] A valid and a missing config behave as before

## Follow-ups / TODO(verify)
- `dev-bootstrap.ts` never loads the config (unchanged).
- `daemon set-password` and the two server writers refuse only a file that cannot be read as a JSON object; a schema failure is refused by start, restart, pair, `extensions list --local` and the daemon itself (documented).
