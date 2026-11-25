# Task 004 — Identity files: the key pair and the server id

- **Sprint:** sprints/sprint-155-damaged-files
- **Status:** done
- **Type:** bugfix
- **Area:** packages/server (daemon bootstrap), packages/cli (rotate-key)
- **Priority:** P2
- **Estimated size:** S
- **Depends on:** task-003

## Goal
Losing the daemon's key pair or its id is never silent.

## Context / why
Finding T5 (first and third bullets). A `daemon-keypair.json` that cannot be read is regenerated
without a log line, which revokes every pairing link; the new file is written in place. A `server-id`
that cannot be written is swallowed, so the id changes on every start.

## Scope references
- `docs/daemon-audit-handoff.md` § "M5 choices" (damaged files), § T5
- `packages/server/src/daemon/bootstrap.ts` (`resolveServerId` :179-200, `resolveDaemonKeypair`
  :202-232), `bootstrap.test.ts` (:1455, :1562)
- `packages/cli/src/daemon-control.ts` (`rotateDaemonKeypair` :363)

## What to build
- A damaged key pair file is set aside (task-001's helper), an error is logged that says pairing links
  are revoked and devices must pair again, and a new pair is written atomically with mode 0600. A
  missing file is still created quietly.
- `server-id`: an empty or unreadable value is set aside and replaced, with an error log; a failed
  write is logged at error and the id is used for this run.
- `daemon rotate-key` writes atomically with mode 0600.

## Out of scope
Making the PID file a lock. The `hostname` field of `server_info`.

## Acceptance criteria
- [ ] A corrupt key pair: a `.corrupt-*` file holds the original bytes, the new file has mode 0600,
      one error is logged.
- [ ] A home where `server-id` cannot be written: the failure is logged.
- [ ] `rotate-key` never leaves a half-written file (crash simulation).

## Test / verification plan
- `npx vitest run packages/server/src/daemon packages/cli`
- `npm run build:server && npm run build:cli`
