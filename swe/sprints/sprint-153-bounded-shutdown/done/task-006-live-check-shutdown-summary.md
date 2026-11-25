# Task 006 — Live check of shutdown, and the update recipes — Summary

- **Sprint:** sprints/sprint-153-bounded-shutdown
- **Completed:** 2026-11-25
- **Status:** done

## What was implemented
Live check of the bounded shutdown on throwaway daemons (temporary homes, spare ports, only the `litellm` API key copied) plus both update recipes in a clean worktree. It found and fixed one real bug: a foreground process in a terminal that ignores SIGHUP (`nohup sleep 301`) outlived `daemon stop`. `killTree()` finds the children asynchronously but the shell was signalled at once, so the shell died first, the child was reparented and nothing was found to kill. `killTree(pid, signal, then)` now runs `then` after the tree has been signalled, and the three PTY backends signal the shell there. The recipes also had two stale spots (the setup did not rewrite `dist/version.generated.js`; scenario 8 expected an offer for a version the earlier rollback had skipped), fixed in `scripts/daemon-update-check/`.

## Live results
| # | Check | Seen |
|---|---|---|
| 1 | Stop under load (Pi turn, terminal, install in flight, a client that stopped reading with about 4 MB queued) | `daemon stop` exit 0 in 1.5 s; agents closed at +20 ms, terminals +40 ms, the install failed with "the daemon is shutting down" at +60 ms, the stalled client dropped at +1.06 s (the 1 s grace); PID file gone, port free, no process naming the home left |
| 1b | Terminal ignoring HUP, TERM and INT | exit 0 in 3.1 to 3.3 s (SIGKILL after the 2 s grace); exposed the bug above |
| 2 | Second SIGTERM during the stop | exit 1 about 30 ms later, nothing left; the PID file stays naming the dead process, and `daemon stop` then says "no running daemon found" and removes it |
| 3 | Second daemon on the same port and home | exit 1 after 357 ms ("address already in use"); the first daemon's PID file unchanged (content, inode, mtime) and `/api/health` still answers |
| 4 | Requests during the stop | `shutting_down` for `list_terminals`, `create_terminal` and `list_agents` in all 12 rounds over 1.7 s; `ping` answered; a new upgrade got 503 |
| 5a | `daemon-update-check` | all ten scenarios pass (74 PASS lines); the old daemon, its `pi` and shell were gone; the helper logged "the old daemon exited" 0.4 s after it started |
| 5b | `binary-update-check` | all eight scenarios pass; the old daemon exited 2.2 s after the helper started |

## Files changed
`terminal/pty-backend.ts`, `bun-pty-backend.ts`, `pty-backend.test.ts` (a real-backend `PtyProcess.kill` test that fails 2 of 2 on the old code), `bun-tests/bun-pty-backend.bun_test.ts` (stub adapted; run: 6 pass), `scripts/daemon-update-check/{lib,run}.mjs` and README; docs: `packages/server/docs/daemon-update-live-results.md` (new 2026-11-25 block), `packages/server/AGENTS.md`, root `AGENTS.md`, `swe/architecture/daemon-bootstrap.md`.

## Build & test results
```
Full-tree gate: build, typecheck 0 errors; lint 0 errors; npm test (two runs) 341 files, 4944 tests passed; bun test pty backend 6 pass
```

## Acceptance criteria
- [x] All five recorded; gates green

## Follow-ups / TODO(verify)
- Not checked: stop through the relay transport or in the desktop app; macOS and Windows shutdown; the Bun-compiled daemon's terminal kill.
- **A slip by the checking agent:** it ran one `skills_install_request` (anthropics/skills, `pdf`), which writes to the owner's real `~/.agents/skills` and `.skill-lock.json` whatever `PI_STUDIO_HOME` is. It removed `skills/pdf` and the lock entry by hand; the lock file's key order or formatting may differ slightly.
- Pre-existing, not changed: `pi-studio terminal send-keys` sends raw text where the daemon expects base64; `terminal capture` prints `text` where the reply carries `screen`.
