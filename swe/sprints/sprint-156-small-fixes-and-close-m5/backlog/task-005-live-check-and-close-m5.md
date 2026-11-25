# Task 005 — Live check of damaged files and the small fixes, and close of M5

- **Sprint:** sprints/sprint-156-small-fixes-and-close-m5
- **Status:** backlog
- **Type:** test
- **Area:** all packages, desktop, docs
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-001, task-003, task-004, sprint-155/task-002, sprint-155/task-005

## Goal
The damaged-file rules and the three small fixes seen working on a real daemon, and M5 closed in the
docs.

## Context / why
Run on a throwaway daemon (temporary homes, a spare port); never the owner's daemon or files.

## Scope references
- `docs/daemon-audit-handoff.md` § Approved improvements (rows 5, 6, 8), § Milestones (M5 and the
  folded small fixes)

## What to build
Run and record:
1. **Config.** A truncated `config.json`: `daemon start` prints the reason and exits non-zero (plain
   and `--json`), nothing listens, the file is unchanged, `set-password` refuses. After the file is
   repaired the daemon starts.
2. **Stores.** `workspaces.json` with one bad record: the other workspaces are there, the original is
   set aside, the log says so. A damaged key pair: set aside, logged, a new pairing link works.
3. **Small fixes.** Deleting a link to a directory leaves the directory; reading a FIFO and
   `/dev/zero` is refused at once; a failed install from a URL with a token shows no token in the
   state file, the log or the client.
4. **Desktop.** The Daemons screen shows both start-failure reasons (if the app can be run here;
   otherwise say so and rely on the tests).
5. **Update check on connect.** A daemon whose last check is old offers a newer version within
   seconds of a client connecting (a local release channel, as in `scripts/binary-update-check/`),
   including over an SSH-style forwarded connection; a second connect inside ten minutes makes no
   request.
Docs: root `AGENTS.md` (§ Persistence layout: the `.corrupt-<timestamp>` files and the config rule),
`packages/server/AGENTS.md`, `swe/architecture/persistence.md`, the CLI README and Fern page if the
start messages are user-facing there; the handoff (improvements 5, 6 and 8, M5 and the small fixes
marked done) and `PLAN.md`. Full gates, and `cd desktop && cargo xtask ci`.

## Acceptance criteria
- [ ] All five recorded, with what was not checked named; gates green.

## Test / verification plan
As above.
