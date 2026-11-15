# Task 003 — `--json` for `daemon start`, `restart`, `pair` and `stop` — Summary

- **Sprint:** sprints/sprint-098-agent-stream-mode-cli-json
- **Completed:** 2026-11-15
- **Status:** done

## What was implemented
Under the global `--json` flag (it precedes the subcommand: `pi-studio --json daemon start`) each command writes exactly one JSON line to standard output:
- `start` / `restart`: `{ up:true, started, host, port, pairingUrl, relay }` (`relay` = endpoint string or `null`); `{ up:false, host, port, error:"not_healthy" }` and non-zero exit when the daemon does not come up.
- **Engineer's decision (asked, answered):** healthy daemon but no key file → `{ up:true, started, host, port, error:"no_keypair" }`, non-zero exit.
- `pair`: `{ pairingUrl, relay }` or `{ error:"no_keypair" }` (non-zero).
- `stop`: `{ stopped:bool }`, today's exit codes.
- No QR code and no prose in JSON mode; errors go to the JSON line, not stderr. `restart` prints only the start result.
- JSON mode is an explicit parameter of `ensureLocalDaemonAndPair`/`printPairing`, passed only by `start`/`restart`/`pair`; `daemon rotate-key`, `onboard` and the bare default action ignore `--json` (tested).

## Files created / changed
`packages/cli/src/daemon-commands.ts`, `daemon-commands.test.ts` (new `daemon --json` block: both start paths, relay, `not_healthy` with fake timers, `no_keypair`, restart one line, pair, stop, byte-for-byte non-JSON output of `start`/`pair`/`stop`, `rotate-key`/`onboard` ignoring the flag), `packages/cli/AGENTS.md`, `packages/cli/README.md`, `swe/features/cli.md`.

## Build & test results
```
$ npx vitest run packages/cli/src/daemon-commands.test.ts packages/cli/src/program.test.ts   52 passed
$ npm run build:cli   success;   wave-1 gate on the combined tree green (271 files / 3781 tests)
```

## Acceptance criteria
- [x] `start --json`: one line, both `started: true` and `started: false` (exit 0), no QR.
- [x] Not healthy → failure shape, non-zero.
- [x] `pair --json` success and `no_keypair` (non-zero).
- [x] `stop --json` true/false with today's exit codes.
- [x] `restart --json` prints exactly one line.
- [x] Non-JSON output of `start`, `pair`, `stop` unchanged (asserted).

## Follow-ups / TODO(verify)
- Spec § 3 and the error table needed the `no_keypair`-with-`up:true` shape; applied by the orchestrator.
