# Task 005 — Live check of instant replies, and close of M4 — Summary

- **Sprint:** sprints/sprint-152-instant-replies-clients
- **Completed:** 2026-11-25
- **Status:** done

## What was implemented
A live check of instant replies on a real bundled Pi 1.4.0 (`litellm.anthropic`, `claude-sonnet-5-5`; only the `litellm` API key copied) in a clean worktree of the committed HEAD (the main tree was being edited), with the CLI and with the web client in headless Chromium (two tabs; a small TCP proxy between Vite and the daemon to kill sockets, block reconnects and hold one tab's incoming frames). It found one real bug, fixed here: **a plain prompt that Pi refuses (no credential) left the agent `running` for ever** (`agent stop` did not free it). Pi answers such a prompt with a failed `prompt` response that carries no id, and the transport dropped any response without a pending id, so no `turn_failed` was produced. `rpc-transport.ts` `handleLine` now hands a failed response with no id (and none pending) to the session as an event, and `event-mapper.ts` maps a failed `prompt` response to `turn_failed {error}` with Pi's text (any other response maps to nothing). Sending plain prompts as correlated requests was rejected: it would put the 60 s request timeout on Pi's pre-run compaction and change many test fakes.

## Files changed
`packages/server/src/agent/providers/pi/{rpc-transport,event-mapper}.ts`, `pi-adapter.test.ts` (mapper test), `rpc-transport.test.ts` (a real child process: "a prompt Pi refuses"); `packages/server/AGENTS.md`; root `AGENTS.md` (the "Create and send answer at acceptance" bullet).

## Live results
| # | Check | Seen |
|---|---|---|
| 1 | CLI `run` | id at 0.36 s, exit 0 at 2.3 s |
| 1 | `run --no-wait` | id at 0.34 s, exit 0 at once; the turn finished later |
| 1 | `send` while running | `busy: agent ... is running`, exit 1 |
| 1 | `wait`, `send`, `--json`, `--timeout` | running agent: idle after 9.8 s; idle agent: 0.35 s; one JSON line each; `--timeout 3` exit 1 and the turn kept running |
| 1 | failed turn | exit 1, reason on stderr, JSON `status: "error"` (through a model the gateway rejects, see below) |
| 1 | no credential | before the fix: hung `running`; after: exit 1 in 0.5 s with Pi's reason |
| 2 | a 45 s tool call, CLI and workbench | no error anywhere; the workbench showed `running` and the Steer composer for the whole 48 s turn, then `idle` |
| 3 | new conversation in the workbench | `running` and the user message at 31 ms; `idle` at 1.76 s; composer in Steer mode with Stop for the whole turn |
| 3 | second tab sends while running (its feed held) | the daemon refused with `busy`; the tab showed "failed to send" and the toast "Couldn't send: the agent is running."; both tabs ended `idle` |
| 3 | prompt Pi refuses | an Error row with Pi's reason after 356 ms, composer idle, sidebar "turn failed" (needs the fix) |
| 3 | inline slash command (extension `/ping`) | message shown, toast "pong", agent `idle`, no `turn_*` rows |
| 3 | reload mid-turn, and four reloads near the end of ~5 s turns | `running` and Steer returned, then `idle`; every run ended idle with a normal composer; 6 completed turns, 0 failed |
| 4 | socket killed mid-turn, reconnect blocked 12 s | "disconnected", three failed attempts, "connection failed - Retry", reconnected by itself 5.7 s after the block was lifted, showed `idle` and the result |
| 4 | socket killed, reconnect at once | back in 0.7 s as `running`, then `idle` with the result |
| 4 | CLI killed mid-wait | exit 1 "the connection closed while waiting for agent ...", the turn kept running, `agent wait` then returned `idle` |

## Build & test results
```
Server Pi provider tests after applying the fix to the main tree: 8 files, 164 passed
Full-tree gate: run at the end of sprint 154 (the tree is shared with running tasks)
```

## Acceptance criteria
- [x] All four recorded, with what was not checked named
- [ ] Gates: run with the sprint-154 wave gate

## Follow-ups / TODO(verify)
- **Not checked:** the workbench through a relay or a remote direct daemon; a plain prompt an extension `input` handler marks `handled` (such a turn would not end: known gap); the Stop button; other browsers than Chromium; the new regression tests were not confirmed to fail without the fix.
- **`run --provider pi/<unknown model>` does not fail**: the daemon only replays the model when both `modelId` and `modelProvider` are set (`agent-service.ts` near :315), and `run -p pi/x` sets no provider, so Pi's default model is used silently. Not an M4 bug; not fixed.
- The workbench polls `agent_session_stats_request` for a draft agent with no session; the daemon logs "has no live session" every 12 s until the first send.
- After about three quick reconnect attempts the workbench shows "connection failed - Retry" and then reconnects by itself some seconds later.
- `swe/features/mcp-server.md` was kept: it is marked retired and linked from `MAIN-SCOPE.md` and three other retired specs.
