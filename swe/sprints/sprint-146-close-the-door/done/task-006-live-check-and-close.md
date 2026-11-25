# Task 006 — Live check of the closed door, and close of M1

- **Sprint:** sprints/sprint-146-close-the-door
- **Status:** done
- **Type:** test
- **Area:** cross-package
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-001, task-002, task-003, task-004, task-005

## Goal
Every M1 behaviour seen working on real processes, the gates green, and the handoff updated.

## Context / why
Live checks run in the orchestrator's session (`swe/av-swe.config.json` `gateNotes.liveChecks`). Never
touch the owner's own daemon: use a temporary `PI_STUDIO_HOME` and `PI_STUDIO_PI_HOME` and a spare port.

## Scope references
- `docs/daemon-audit-handoff.md` § 14 (probe recipe), § Milestones (M1)

## What to build
Run and record:
1. Throwaway daemon: the `Origin: https://evil.example` probe → 403; no `Origin` → 101.
2. `pi-studio -H 127.0.0.1:<port> agent list` works.
3. `PI_STUDIO_LISTEN=0.0.0.0:<port>` without a password → refused with the message; with one → starts.
4. Production web build (`vite preview` or the Docker image) against a local relay and the throwaway
   daemon with relay enabled: an address is refused with the message; the pairing link connects.
5. `npm run dev` web client + `npm run dev:daemon` connect.
6. Desktop app: a local entry and a direct entry connect (`npm run snapshot` on headless Linux or the
   real app).
Then: full gates (`npm run build`, `npm run typecheck`, `npm run lint`, `npm test`), `cd desktop &&
cargo xtask ci`; mark M1 done in `docs/daemon-audit-handoff.md` § Decisions and in `swe/sprints/PLAN.md`.

## Acceptance criteria
- [ ] All six checks recorded in the summary with what was seen; gates green.

## Test / verification plan
As above.
