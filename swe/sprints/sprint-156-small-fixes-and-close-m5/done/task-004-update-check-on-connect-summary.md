# Task 004 — Check for a daemon update when a client connects — Summary

- **Sprint:** sprints/sprint-156-small-fixes-and-close-m5
- **Completed:** 2026-11-25
- **Status:** done

## What was implemented
`UpdateService.checkIfStale()` starts an automatic check unless auto-check is off, the service is closed, a check or an update is running, or the last attempt began less than `UPDATE_CONNECT_CHECK_MIN_AGE_MS` (10 min) ago (`lastAttemptAt` is set when `runCheck` begins, so a failed or manual check counts). It is `check("automatic")`: no `checking` state, a failure shows nothing, a skipped version is not offered, ten connects in one tick start one check. `bootstrap.ts` calls `void updateService.checkIfStale();` once after `sendUpdateStatus` for direct sessions (`onSession`) and relay sessions (`onSessionOpen`); the session still gets the stored status first and a change reaches it through the existing broadcast. Unchanged: the 6 h timer, `dev-bootstrap.ts`, all client code. Also (not requested): a failed lookup writes one `info` line, `update: check found no release`, with `by` and `failure`, because a failed check left no trace on the host.

## The SSH finding (why the pill was missing)
**The cause on the owner's SSH daemon was not established.** The compiled binary was run the way the app starts one on a host (`<home>/bin/versions/0.0.132/` with a `bin/current` link, `daemon start` through it, a temp `PI_STUDIO_HOME`, a local release channel through `PI_STUDIO_DAEMON_UPDATE_URL`, no Docker):
- Install kind: ruled out. The daemon reports `installKind: binary` and is managed (the blocker resolves the `bin/current` link).
- A newer release at start works: one request, a connecting client got `available 0.0.133` at once.
- **Cause A, reproduced:** a failed start-up check (channel down at start) left `idle` with no `checkedAt` or `checkError`; 20 s after the channel came back a second client still saw `idle` (one request in total, no log line).
- **Cause B, reproduced:** the start-up check saw the daemon's own version; a newer release was published; a connect 15 s later got the old `idle` and `checkedAt`. A daemon the app left running would show this for hours.
- Not excluded: no newer release than the app's pin (`desktop/daemon-pin.json` says 0.0.131, tag `daemon-v0.0.132` exists; the real `latest.json` was not read); a host that cannot reach the channel at all (the pill stays missing even now; only "Check now" shows `checkError`). The workbench was read, not run: the pill is drawn for `available` for any entry.
The check on connect closes causes A and B.

## Files changed
`packages/server/src/update/update-service.ts`, `daemon/bootstrap.ts` (two call lines), tests (`update-service.test.ts`, `update-e2e.test.ts`, `bootstrap.test.ts` relay rig, new `test-support/update-check-rig.ts`); docs: `packages/server/AGENTS.md`, root `AGENTS.md`, `swe/features/self-update.md` (§ Resolved by the build), `packages/server/README.md`, `README.md`, `fern/pages/configuration/daemon.mdx`.

## Build & test results
```
npx vitest run packages/server/src/update packages/server/src/daemon -> pass (the one extension-packs failure seen mid-run passed 3 of 3 alone: it ran while another task was editing extension files); mutation check: with either hook line removed its e2e test fails
Live, new binary, real clock: start-up check found the channel down; connects at +3 s and +60 s made no request; the channel then named 0.0.133 and a connect at +607 s got the stored idle at once and, 11 ms later, available 0.0.133 (exactly two requests in the channel log)
Full-tree gate: build, typecheck 0 errors; lint 0 errors; npm test (three runs) 349 files, 5102 tests passed; oxfmt clean
```

## Acceptance criteria
- [x] A connect more than 10 minutes after the last attempt runs one check; an update found is broadcast (fake clock, direct and relay e2e, live)
- [x] Ten connects within a minute run one check at most; none during a running check or an apply
- [x] A failed start-up check retried at 10 minutes, not at 1 minute
- [x] Auto-check off: a connect runs no check (off at start and switched off later)
- [x] The SSH finding is written down with what was seen

## Follow-ups / TODO(verify)
- A connect check, like the 6 h timer, replaces a `failed` state with `available` or `idle`: a page reload after 10 minutes clears "Daemon update failed".
- The workbench Settings text ("at start and every six hours") and `packages/server/docs/daemon-update-live-results.md` still describe the old behaviour (client change out of scope; add a dated entry from the scratch evidence).
- The real cause on the owner's SSH daemon is still open: a host that cannot reach the release channel, or no newer release than the app's pin. Ask for the daemon's log line `update: check found no release` (new) or press "Check now" in the workbench on that entry.
