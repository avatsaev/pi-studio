# Task 005 — Live check with a real Pi, and docs — Summary

- **Sprint:** sprints/sprint-149-agent-recovery
- **Completed:** 2026-11-25
- **Status:** done

## What was implemented
No new feature. The recovery behaviour was exercised on a throwaway daemon (temporary `PI_STUDIO_HOME` and `PI_STUDIO_PI_HOME` holding a copy of the owner's Pi `auth.json` and a minimal `settings.json`; extension auto-sync and update checks off; port 47391; the owner's daemon and Pi directory untouched), the bundled Pi 1.4.0 and `anthropic/claude-sonnet-4-5`. Everything was stopped and the temporary directory removed afterwards. One defect found and fixed: a Pi exit that `close()` asked for (SIGTERM gives 143) was logged at error level as "pi process exited non-zero"; it is now an info "pi process exited" (`rpc-transport.ts`, two tests adjusted). Docs: the lifecycle, busy and timeout rules were written by tasks 001-004 in `packages/server/AGENTS.md` and `packages/cli/AGENTS.md`; the handoff records the answers below and M3 part 1 as done.

## Live results
| # | Check | Seen |
|---|---|---|
| 1 | `kill -9` the agent's Pi in the middle of a `sleep 40` tool call | The CLI timeline ends with `--- turn failed: pi process exited (code null, SIGKILL) ---`; `agent ls` shows `error`; the `agent run` that started the turn returned the agent id (its RPC resolved); no Pi left |
| 1 | Next message to the same agent | `sent`; a new Pi answered `back`; `agent ls` `idle`; the same session file grew (6 to 9 lines), a second session file was not started; one Pi process |
| 2 | Two `agent send` at once | One `sent`, the other `error: busy: agent <id> is running (handler_error)`; a later send once idle worked; each prompt appears once in the timeline |
| 3 | `agent reload` over a live agent | The old Pi was replaced (pid changed), still exactly one child of the daemon |
| 3 | `agent archive` in the middle of a `sleep 45` turn | `archived`; the run's RPC had resolved; timeline `--- turn canceled ---`; the daemon's Pi count went 2 to 1; no orphaned `sleep` (tree kill) |
| 3 | SIGTERM of the daemon in the middle of a turn (earlier run) | Daemon gone within 1 s, its Pi gone, nothing left |
| 4 | `kill -9` of the daemon in the middle of a turn | Both of its Pi processes exited within 1 s (stdin EOF). The `sleep 40` the running turn had started survived as an orphan (also true when Pi itself is killed with SIGKILL) |

## Build & test results
```
Full tree after the log fix: npm run build, typecheck, lint 0 errors; npm test: 327 files, 4693 tests passed; oxfmt clean on changed files
```

## Acceptance criteria
- [x] All four recorded with what was seen

## Follow-ups / TODO(verify)
- The first attempt, on `claude-haiku-4-5` with the bundled Pi 1.4.0, never produced an assistant message (also when `pi --mode rpc` was driven by hand); the same prompt answered on Pi 1.6 and on 1.4.0 with sonnet. Recorded in the handoff as not fixed; no turn timeout exists by design. It is a Pi 1.4.0 issue, not a daemon one.
- A tool subprocess orphaned by an abrupt Pi or daemon death is not reaped (`close()` does reap its tree).
- Workbench check of the failed-turn row was not done (CLI only).
