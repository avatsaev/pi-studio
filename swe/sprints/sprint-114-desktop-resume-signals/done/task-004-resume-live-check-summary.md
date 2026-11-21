# Task 004 — Linux live check of the resume signals — Summary

- **Sprint:** sprints/sprint-114-desktop-resume-signals
- **Completed:** 2026-11-21
- **Status:** done

## What was done
Only `desktop/docs/development.md` changed: a section "The resume signals in the real webview" (container differences, the stop and continue commands, the address-change commands). No source change was needed.

Setup: a private copy of the debug binary; container `pi-desktop-xvfb` with `--cap-add NET_ADMIN` and its own network (so the dummy interface cannot touch the host); an explicit `Xvfb :99`, a D-Bus session bus, `WebKitWebDriver`; the app with `--config-dir`, `--secret-store=file`, a control port; the dev daemon (mock agent) on the host at `172.17.0.1:<free port>`; the host's `ip` and its libraries mounted and run as root in the container. The page was observed from inside (a `MutationObserver` on the connection bar, a 100 ms gap recorder, a marker `window.__resumeLiveMarker`), `resumeSignals` through `ui.inspect`. Everything was removed afterwards; one screenshot kept at `/tmp/ResumeLive-final.png`.

## The three runs
**(1) Stop 30 s, daemon restarted meanwhile, continue** (`kill -STOP` of the app, `WebKitNetworkPr` and `WebKitWebProces`; `kill -9` and a new daemon on the same port at +8 s; `kill -CONT` at 30 s): `resumeSignals.wake` 4 to 5; the page frozen 30,116 ms; `resume signal: wake` logged on the same millisecond the page woke; the bar went `connected`, `disconnected` (+4 ms), `connecting...` (+6 ms), `connected` (+12 ms); the daemon logged the new client 9 ms after the continue. A first run of the same shape: connected at +10 ms. Page not reloaded: the marker stayed `m1`, `performance.timeOrigin` unchanged, one navigation entry (the app does not log `boot` calls, so the marker and the origin are the proof). The page showed `Scratch · connected`.

**(3) Daemon left running, stop 30 s, continue:** frozen 30,162 ms, `wake` 5 to 6, no bar change, no new `ws client connected`, no disconnect: the connection stays open after the probe (a repeat, wake 6 to 7, the same).

**(2) Address changes** (`ip link add dum0 type dummy`, `ip addr add/del 10.99.N.1/24 dev dum0`):

| Step | `network` | Event logged |
|---|---|---|
| add `10.99.0.1/24` | 0 to 1 | +2.65 s |
| remove it | 1 to 2 | +3.57 s |
| add `10.99.1.1` at t, `10.99.2.1` at t+2.04 s | 2 to 3 | one event, 2.44 s after the second change |
| delete both, 2.04 s apart | 3 to 4 | one event, 1.31 s after the second |

## Extra checks
1. **What speeds the reconnect:** with the wake event, connected 10 to 12 ms after the continue (reconnect started 2 to 5 ms after). Control: an 8 s stop with the daemon killed and restarted and no wake (`wake` stayed 4): `disconnected` +3 ms, `connecting...` +552 ms, `connected` +557 ms, so the event saves about 0.55 s of the page's backoff. The page's own ping timeout was not exercised (a killed daemon leaves a closed socket); the case of a silently dead socket (a daemon frozen with `kill -STOP` instead of restarted) is not covered: TODO(verify), moved to sprint 117.
2. **Deferred change:** a 14 s stop with the daemon running (`wake` 6 to 7 logged at 15:25:15.382); an address added 39 ms after the continue; `network` stayed at 4 for 5 s of polls, then became 5; the log shows `resume signal: network` at 15:25:21.382, 6.0 s after the wake (5 s limit plus the reading and settling steps). Not lost, exactly one event, never two within 5 s.

## Wave gate
No source changed in this task (documentation only); the source gates of wave 6 stand (`cargo xtask ci` all 8 steps, app check, lint and 120 tests, 2026-11-21).

## Acceptance criteria
- [x] The three runs are above with commands and times.
- [x] The two automated Resume criteria are ticked with this evidence; the socket was the webview's here and both are run again with the bridge in sprint 117.
- [x] `cargo xtask ci` passes (wave gate).

## Follow-ups / TODO(verify)
- A plain `kill` of the dev daemon does not free the port while a stopped client holds a connection; use `kill -9` (in the recipe).
- The page's reaction to the `network` reason was not exercised; only the counter and the log line were seen. The host handles both reasons the same way (114/t003).
- One 8 s control run showed page events about 0.8 s before the stamped continue; a clean repeat did not. TODO(verify): why.
- The page's own backoff once took 16 s to reconnect after a daemon restart (not related to the resume event): TODO(verify) whether that is the intended backoff cap.
- The silent dead socket (daemon frozen, not restarted): sprint 117.
