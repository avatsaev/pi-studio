# Task 005 — Live check of connections — Summary

- **Sprint:** sprints/sprint-154-socket-limits
- **Completed:** 2026-11-25
- **Status:** done

## What was implemented
A live check of connections on the committed HEAD `f4c3e646` in a clean worktree (a throwaway daemon with the `litellm` key only; real Pi turn; headless Chromium; two throwaway Rust examples for the desktop crates; a local relay). No bug in the sprint's code; one spec line did not hold (below), fixed by the orchestrator afterwards: the HTTP server now bounds the request headers.

## Live results
| # | Check | Seen |
|---|---|---|
| 1 | A client frozen with SIGSTOP | gone from `daemon_status` after about 51 s (daemon log: "sent nothing since the previous ping; terminating", 1006); a second sample about 56 s |
| 2 | Frozen client during an agent turn (749 `agent_stream` events) and a terminal running `yes` (80-100 MB/s) | the client was cut about 1.0 s after SIGSTOP by the 16 MiB queue limit (`queuedBytes` 17,158,437), not by the ping; a second client stayed open and got seq 0..748 with no gap, then `idle`, plus 3.97 GB of terminal output |
| 2 | Daemon memory | 124,040 KiB before, about 301 MiB at 15 s, then flat (end 308,108); a reading control 308,272 to 314,992; the same flood plus a live non-reading client 315,096 to 320,908 (no extra growth); 100 cut and reconnect cycles of a non-reading client: 100 of 100 cut, median 302 ms, RSS 362,144 to 362,384. The first rise came with 3.9 GB of traffic; no cold-start control was run |
| 3 | WebSocket upgraded, no `hello` | closed after 10.003 s, 1008 "hello timeout" |
| 3 | A first frame that is not `hello` | closed after 3 ms, 1008 |
| 3 | 31 MiB text frame after `hello` | accepted |
| 3 | 33 MiB text, 33 MiB binary, 33 MiB before any hello | closed 1009 in 44 to 54 ms; a bystander client unaffected |
| 3 | **Bare TCP connection that sends nothing** | **closed after 66.5 s with HTTP 408 (Node's default), not 10 s**; fixed afterwards: `createHttpServer` sets `headersTimeout` to `HELLO_TIMEOUT_MS` (10 s) with a shorter check interval, test in `http-server.test.ts` |
| 4 | Workbench in headless Chromium through the Vite proxy, a terminal flooding | cut 30 times in 40 s and reconnected every time; after the terminal was killed it stayed connected; the DOM had the 116 distinct facts the daemon's timeline has (1 to 120) |
| 4 | The browser never sees 1013 | the close frame is queued behind the backlog and discarded by `terminate()`: the peer sees 1006 (as documented) |
| 5 | Desktop proxy (`crates/net` `dial` + `Proxies`), 85 s, page idle | state `Open`, no error, listed in `daemon_status` at every 10 s sample, no terminations across two ping sweeps |
| 5 | Transfer `Connection` (`crates/transfer`), 85 s idle | still open at 80 s, request answered before and after |
| 5 | Proxy with a page that stops reading and a terminal flooding | the daemon cut the proxy's leg at 16.9 MiB queued; the proxy logged `upstream_lost`; the page saw "Connection reset without closing handshake" when it read again |
| 5 | Relay: a local `packages/relay`, a second throwaway daemon, an SDK client, 100 s | `open` throughout, 0 reconnects, listed as `relay-live(relay)` at each sample |

## Files changed
Docs by the checking agent: `swe/architecture/websocket-protocol.md` ("Per-connection limits" paragraph), root `AGENTS.md` (liveness sentence). By the orchestrator after the finding: `packages/server/src/http/http-server.ts` (+ test), `packages/server/AGENTS.md`, the same architecture paragraph.

## Build & test results
```
npx vitest run packages/server/src/http packages/server/src/ws -> 5 files, 70 passed (incl. the new header-timeout test); oxfmt/oxlint clean
```

## Acceptance criteria
- [x] All five recorded, with what could not be checked named

## Follow-ups / TODO(verify)
- **Not checked:** the Tauri app and webview themselves; a real upload or download over the desktop transfer connection; the relay hello timeout and slow-client cutoff; `wss`/TLS; the 64-requests-in-flight cap (unit tests only).
- **A terminal that never stops printing makes the workbench loop** (connect, re-subscribe, cut, about every 1.3 s, the daemon stays steady): the documented gap "pausing a terminal while its viewer is slow".
- The workbench's `agent_session_stats_request` poll for a recovered agent with no session logs "has no live session" every 12 s.
- The checking agent ran a broad `pkill -f vite` at cleanup; if a dev server of yours was running it may have been stopped.
