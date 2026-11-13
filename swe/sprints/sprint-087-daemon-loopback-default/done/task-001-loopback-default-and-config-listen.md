# Task 001 — Production daemon binds loopback by default; `config.json` `daemon.listen` takes effect

- **Sprint:** sprint-087-daemon-loopback-default
- **Status:** done
- **Type:** bugfix
- **Area:** packages/server (daemon/main, daemon/bootstrap, daemon/index)
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** none

## Goal

`pi-studio-daemon`, `npm start` and `npm run start:server` bind `127.0.0.1:6767` unless the operator
opts in. The listen address resolves as `PI_STUDIO_LISTEN` → `config.json` `daemon.listen` → default.

## Context / why

**Repro:** with no `PI_STUDIO_LISTEN`, `node packages/server/dist/daemon/main.js` logs
`listening on http://0.0.0.0:6767`. There is no password by default, and the Host allowlist always
accepts literal IPs (`http/host-allowlist.ts`), so any LAN peer can drive agents (shell, files,
terminals). Every other source says loopback:
- `daemon/index.ts` `DEFAULT_DAEMON_LISTEN`;
- the `config/daemon-config.ts:88` schema default;
- `protocol/endpoint.ts`;
- MAIN-SCOPE § 2;
- the CLI spawn path, which always sets `PI_STUDIO_LISTEN`.

Only `main.ts:11` overrides it. Separately, `daemon.listen` in `config.json` is parsed, with
`PI_STUDIO_LISTEN` overriding it at `daemon-config.ts:237`, but no entry point reads it, so the
setting does nothing.

**Expected:** a loopback bind by default. A configured `daemon.listen` or `PI_STUDIO_LISTEN` wins.

## Scope references

- swe/MAIN-SCOPE.md § 10 (D35), § 2
- packages/server/src/daemon/main.ts; daemon/index.ts (`DEFAULT_DAEMON_LISTEN`,
  `parseDaemonListen`, `createDaemonRuntimeInfo`)
- packages/server/src/daemon/bootstrap.ts:93-127 (`DaemonOptions` host/port required; `DaemonHandle`),
  :239 (`loadConfig`), :920 (`httpServer.listen`)
- packages/server/src/config/daemon-config.ts:88, :237
- packages/cli/src/daemon-control.ts:114-139 (CLI spawn: always passes `PI_STUDIO_LISTEN`, so it
  must stay unaffected)

## What to build

- `DaemonOptions.host`/`port` become optional. When either is omitted, `startDaemon` takes it from
  `parseDaemonListen(config.daemon.listen)`, where `loadConfig` has already applied the env override
  and the schema default. Explicit `opts.host`/`port` still win, for embedders and tests.
- `DaemonHandle` gains `listen: { host: string; port: number }`, the address actually bound.
- `main.ts` stops computing a listen address. It calls `startDaemon({ onFatalError })` and logs
  `handle.listen`. The `0.0.0.0` literal and its header comment go.
- The config default and `DEFAULT_DAEMON_LISTEN` must agree. Either derive one from the other, or
  add a test that asserts they are equal. Pick one, not both.

## Out of scope

- The unprotected-bind warning and the dev daemon (task-002); docs (task-003).
- Docker: its images set `PI_STUDIO_LISTEN=0.0.0.0:6767` explicitly and keep working unchanged.

## Acceptance criteria

- [ ] Regression test: `startDaemon` with no host/port, no env and no config binds `127.0.0.1`
  (port 0 via config in the test), and `handle.listen.host === "127.0.0.1"`.
- [ ] `config.json` `daemon.listen: "127.0.0.1:<port>"` is honoured. `PI_STUDIO_LISTEN` beats it.
  Explicit `opts.host`/`port` beat both.
- [ ] An invalid `daemon.listen` fails startup with the existing `Invalid listen address` error,
  routed through the fatal-error contract (no `process.exit` inside `startDaemon`).
- [ ] CLI `daemon start` behaviour is unchanged (existing CLI tests pass).
- [ ] Manual check: `npm run start:server` with a clean env logs `127.0.0.1:6767`. With
  `PI_STUDIO_LISTEN=0.0.0.0:6767` it logs `0.0.0.0`.

## Test / verification plan

- `npx vitest run packages/server/src/daemon packages/server/src/config packages/cli`
- `npm run clean && npm run build:server && npm run build:cli` (signature change)
