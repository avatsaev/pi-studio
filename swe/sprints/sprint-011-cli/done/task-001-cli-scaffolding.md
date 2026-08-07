# Task 001 — CLI scaffolding + connection + output rendering

- **Sprint:** sprint-011-cli
- **Status:** done
- **Estimated size:** S
- **Depends on:** task-002 (sprint-007, Pi-StudioClient)

## Goal
Stand up the Commander.js CLI with global options, daemon connection, and table/json output
rendering.

## Scope references
- `clean-room-scope/features/cli.md` § Global options, § Behavior (main), § Data & Persistence

## What to build
- `packages/cli/src/`: Commander program with global options `--host <host>` (default local daemon),
  auth/relay options (password, relay endpoints).
- `main(argv)`: parse global options; connect `DaemonClient(host)` (hello handshake); dispatch
  subcommand → WS RPC(s); render output (table/json) to stdout; exit code reflects success/failure.
- Persist a stable local client id (e.g. `cli-client-id`) used in the hello `clientId`
  (`clientType:"cli"`).
- Surface `rpc_error` messages with a nonzero exit code.

## Out of scope
- Specific command groups (tasks 002–004). Local daemon spawning + QR (task-003).

## Acceptance criteria
- [ ] The CLI connects to a daemon and completes the hello handshake with a stable `clientId`.
- [ ] `--host <host:port>` targets a remote daemon over the same protocol.
- [ ] RPC failures surface `rpc_error` and exit nonzero.
- [ ] Output renders as table or json per flag.

## Test / verification plan
- Tests: `npx vitest run packages/cli/.../cli-core.test.ts` against a test daemon — connect, host
  targeting, error exit code.
- Manual: `pi-studio --host 127.0.0.1:<devport> ls` connects.

## Notes
- The daemon owns all real state; the CLI is a thin client over `@av-pi-studio/client`.
