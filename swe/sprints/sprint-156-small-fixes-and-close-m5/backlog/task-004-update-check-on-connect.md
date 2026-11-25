# Task 004 — Check for a daemon update when a client connects

- **Sprint:** sprints/sprint-156-small-fixes-and-close-m5
- **Status:** backlog
- **Type:** feature
- **Area:** packages/server (update service, bootstrap), workbench only if the SSH finding needs it
- **Priority:** P2
- **Estimated size:** S
- **Depends on:** task-002

## Goal
Connecting to a daemon shows an available update within seconds, instead of whatever the daemon found
up to six hours ago.

## Context / why
Owner request, 2026-11-25: after starting and connecting to a daemon over SSH from the Daemons screen,
no update notification appeared. The daemon checks once at start and then every 6 h
(`UPDATE_CHECK_INTERVAL_MS`); a connecting session only receives the stored status
(`sendUpdateStatus`, right after `server_info`). So a connection shows a result that can be hours
old, and a check that failed at start (no network yet) is not retried for 6 h. The cause on the
owner's SSH daemon is **not established**: "the pill on an SSH entry's daemon" was never checked live
(`AGENTS.md` § `daemon_update_*`). Find it first.

## Scope references
- `docs/daemon-audit-handoff.md` § Milestones (this task is an owner addition to M5, not an audit finding)
- `packages/server/src/update/update-service.ts` (`start` :315-328, `check(by)` :424, `runCheck`
  :434-470: an automatic check is silent and a failed one changes nothing a user sees; the skipped
  version; the timer near :590), `update-service.test.ts`
- `packages/server/src/daemon/bootstrap.ts` (`sendUpdateStatus` :501, its two call sites: the direct
  session near :835 and the relay session near :889), `dev-bootstrap.ts`, `update/dev-update-script.ts`
- `packages/server/src/update/install-kind.ts`, `binary-update.ts`, `binary-manifest.ts`
- Workbench: `packages/workbench/src/features/connection/` (`use-daemon-update.ts`,
  `daemon-update-store.ts`, `daemon-update-presentation.ts`, `DaemonUpdateIndicator.tsx`)
- Desktop: how an SSH entry's daemon is installed and started (`desktop/crates/ssh`, `install`), and
  `desktop/docs/platform-checks.md` § Daemon self-update rows

## What to build
- **First, the SSH path.** Reproduce with a daemon run the way the app runs one on an SSH host (the
  binary under `$PI_STUDIO_HOME/bin/versions/<v>/`, or the closest stand-in available here) against a
  local release channel (`PI_STUDIO_DAEMON_UPDATE_URL`, as `scripts/binary-update-check/` does). Say
  which of these it is: no newer release than the app's pin; a failed first check; a stale result; the
  install kind detected as something that cannot update; or the workbench not showing the pill for
  that entry. Fix what is found if it is small and in the files above; otherwise report it.
- **Check on connect.** When a session completes `hello` (direct or relay), the daemon starts an
  automatic check unless auto-check is off, an update or a check is already running, or the last
  **attempt** (successful or not) is younger than `UPDATE_CONNECT_CHECK_MIN_AGE_MS = 10 * 60_000`.
  The rule lives in `UpdateService` (for example `checkIfStale()`), so every client gets it and no
  client changes. The session still gets the stored status at once; a change found by the check
  reaches it through the existing broadcast.
- It stays an automatic check: no `checking` state, a failure shows nothing, and a version skipped
  after a rollback is not offered.
- The dev daemon's scripted update flow is unaffected.
- Docs: `packages/server/AGENTS.md` (update section), root `AGENTS.md` (`PI_STUDIO_UPDATE_AUTOCHECK`
  row and the `daemon_update_*` bullet), `swe/features/self-update.md`.

## Out of scope
A client-side "check now" on connect. Changing the 6 h timer. The desktop app's own update.

## Acceptance criteria
- [ ] A connect more than 10 minutes after the last attempt runs one check; an update found is
      broadcast to the connected session (fake clock, fake registry).
- [ ] Ten connects within a minute run one check at most; a connect during a running check or an
      apply starts none.
- [ ] A failed start-up check followed by a connect 10 minutes later retries; a connect 1 minute
      later does not.
- [ ] Auto-check off: a connect runs no check.
- [ ] The SSH finding is written down with what was seen.

## Test / verification plan
- `npx vitest run packages/server/src/update packages/server/src/daemon`
- `npm run build:server`

## Notes
The first connect after a daemon start usually lands while the start-up check is still running or has
just finished, so it is covered by the "already running" and "young attempt" rules.
