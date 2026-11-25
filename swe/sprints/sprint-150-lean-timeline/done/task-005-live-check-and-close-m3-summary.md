# Task 005 — Live check of the lean timeline, and close of M3 — Summary

- **Sprint:** sprints/sprint-150-lean-timeline
- **Completed:** 2026-11-25
- **Status:** done

## What was implemented
No source change. A throwaway daemon (temporary `PI_STUDIO_HOME` and `PI_STUDIO_PI_HOME`, port 47392, extension auto-sync and update checks off; the owner's daemon and Pi directory untouched) with a **real bundled Pi 1.4.0** through the owner's `litellm.anthropic` gateway (`global.anthropic.claude-sonnet-5-5`). Credentials: only the `litellm` entry (an API key) was copied into the temporary Pi home, never the OAuth entries. Everything was stopped and the directory removed afterwards. Docs: `packages/server/AGENTS.md` (written by tasks 001, 003, 004), root `AGENTS.md` persistence layout, `swe/features/timeline-streaming.md`, `swe/architecture/persistence.md`; the design document is marked "not adopted"; handoff and `PLAN.md` mark M3 done.

## Live results
| # | Check | Seen |
|---|---|---|
| 1 | Three turns on one agent, then stop the daemon (SIGTERM, gone within 2 s) and start it again | `agent ls` shows the agent `idle` |
| 1 | **First action after the restart: `agent send`**, then read the history | The history has 115 lines (111 before, plus the new turn): the first prompt ("Write the numbers 1 to 40") is still there, three earlier turns plus the new one show `turn completed` (4), and the new prompt and its answer `after-restart` come last |
| 2 | Memory over three turns | Daemon RSS 168,376 kB at the start, 168,760 kB after three turns of about 30 lines each (flat) |
| 2 | Rows per message | Not visible from outside the daemon (the CLI prints one line per output line). The merge is pinned by the equivalence test and measured in task-003: 4 rows instead of 304 for a 300-chunk message |
| 3 | Archive the agent, then fetch its history | `archived`; the fetch still returns the 115 lines |
| 3 | Delete the agent, then fetch | `deleted`; an empty history; no error-level log line in the whole run |
| 3 | Registry empty after archive and delete | Covered by `timeline-eviction.test.ts` (`manager.timelines.size`); not visible from outside the daemon |

## Build & test results
```
Full tree after task 004: npm run build, typecheck, lint 0 errors; npm test 330 files, 4714 tests passed; oxfmt clean on changed files
```
`packages/server/src/daemon/update-e2e.test.ts` ("the apply handoff on the production daemon") failed in about one in three full runs during this task (`broadcastKinds` has an extra leading `idle`), and passes alone four of four times. It is a timing race between the status broadcast sent on connect and the test's collection; it already failed once during sprint-149 and is not caused by the timeline work.

## Acceptance criteria
- [x] All three recorded; gates green apart from the intermittent test above
- [ ] Rows per message and registry size were checked only through tests, not from outside the daemon

## Follow-ups / TODO(verify)
- Harden or fix the `update-e2e` race (a test-side wait for the connect-time broadcast).
- After a restart a turn killed by a Pi crash shows as completed (the failure reason lives only in daemon memory); accepted.
