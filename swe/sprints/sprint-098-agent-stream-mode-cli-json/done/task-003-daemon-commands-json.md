# Task 003 — `--json` for `daemon start`, `restart`, `pair` and `stop`

- **Sprint:** sprint-098-agent-stream-mode-cli-json
- **Status:** done
- **Type:** feature
- **Area:** packages/cli (daemon commands)
- **Priority:** P2
- **Estimated size:** S
- **Depends on:** none

## Goal
A program that supervises the daemon can read the result of starting, pairing and stopping it as one line of JSON.

## Context / why
`--json` is a global flag, but among the `daemon` commands only `status` honours it. `start`, `restart` and `pair` print prose, a terminal QR code and `Pairing link: <url>`; `stop` prints one sentence. The desktop client will start or find a local daemon through this CLI and cannot parse that.

## Scope references
- `swe/features/desktop-client-protocol-followups-2.md` § 3, § Error handling & edge cases (the two `--json` rows)
- `swe/features/cli.md` (`daemon` command group)
- `packages/cli/src/daemon-commands.ts` (`printPairing`, `ensureLocalDaemonAndPair`, `registerDaemonCommands`, `resolvePairingRelayInfo`)
- `packages/cli/src/daemon-control.ts` (`stopDaemon`, `waitForDaemon`, `daemonStatus`), `packages/cli/src/pairing.ts` (`buildPairingUrl`, `readDaemonPublicKey`)
- `packages/cli/src/daemon-commands.test.ts`, `packages/cli/src/relay-commands.test.ts` (a command-level harness: `program.parseAsync` with a recording sink)
- `packages/cli/AGENTS.md`, `packages/cli/README.md`

## What to build
With the global `--json` flag each command writes exactly one line of JSON to standard output and nothing else (no QR code, no prose). Without the flag its output does not change.

| Command | Success | Failure (non-zero exit) |
|---|---|---|
| `daemon start`, `daemon restart` | `{ "up": true, "started": <bool>, "host", "port", "pairingUrl", "relay" }` | `{ "up": false, "host", "port", "error": "not_healthy" }` |
| `daemon pair` | `{ "pairingUrl", "relay" }` | `{ "error": "no_keypair" }` |
| `daemon stop` | `{ "stopped": true }` | `{ "stopped": false }` |

- `started` is `false` when a daemon was already running at that address.
- `relay` is the relay endpoint the pairing link routes through, or `null`.
- `daemon restart --json` prints one line: the result of the start.
- `daemon status --json` is unchanged.

Shared documents: `docs/desktop-client-handoff.md` and `swe/features/desktop-client-protocol-followups-2.md` are touched by most tasks of this sprint. Run alone, update what this task makes stale there. In a parallel wave, do not edit them: put the exact changes in the summary and the orchestrator applies them after the wave gate.

## Out of scope
- `pid` or version in any JSON output; `daemon status --json`.
- `daemon rotate-key`, `set-password`, `onboard`, and the `relay` command group.

## Acceptance criteria
- [ ] `daemon start --json` prints one parseable line with the fields above both when it starts a daemon (`started: true`) and when one is already running (`started: false`, exit 0), and renders no QR code.
- [ ] When the daemon does not become healthy, `daemon start --json` prints the failure shape and exits non-zero.
- [ ] `daemon pair --json` prints `pairingUrl` and `relay`; before any daemon has run it prints `{ "error": "no_keypair" }` and exits non-zero.
- [ ] `daemon stop --json` prints `{ "stopped": true }` or `{ "stopped": false }` with today's exit codes.
- [ ] `daemon restart --json` prints exactly one line.
- [ ] Without `--json`, the output of all four commands is byte-for-byte what it is today (asserted for at least `start` and `pair`).

## Test / verification plan
- `npx vitest run packages/cli/src/daemon-commands.test.ts packages/cli/src/program.test.ts`
- `npm run build:cli`
- `npx oxfmt <changed files>`

## Notes
- **Unspecified case:** `daemon start --json` when the daemon is healthy but no key file exists. The spec's failure shape for `start` says `up: false`, which would be untrue here. Ask the engineer before choosing; until answered, do not invent a shape, and record the answer in the spec.
- `pairingUrl` on a relay-routed link is a credential, exactly as the printed link is today.
- In JSON mode, errors go into the JSON line on standard output, not as prose on standard error.
