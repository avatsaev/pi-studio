# Task 008 — Choose the bridge design, respecify § 2–3, replan sprints 115 and 116 — Summary

- **Sprint:** sprints/sprint-112-desktop-ipc-benchmark
- **Completed:** 2026-11-22
- **Status:** done

## The decision
On 2026-11-22 the owner chose the loopback WebSocket proxy owned by Rust, on all three platforms ("ok then let's go with proxy design, confirmed"), after asking for and reading the pros and cons of every design, the architecture, the performance against today's design, the other advantages and the disadvantages. Recorded as decision T5 in the spec. Accepting it accepts a webview socket to `127.0.0.1` only; the socket to the daemon is Rust's.

## What was written (documents only; no source changed)
- `swe/features/desktop-transport-bridge.md`: status; decision T5; proposals P11–P16; § 2 (one command, `transport_open { url }` answering `{ localUrl }`); § 3 (the page's leg: a per-connection listener on `127.0.0.1`, a single-use 256-bit token, `Origin` and `Host` checks, 10 s; the pump; what Rust holds; the close table); § 4 (the proxied `Transport` is the SDK's WebSocket transport with `connect` replaced); § 7 (states and `lastError` codes); § 8; the pseudocode; the error table (`proxy_failed`, the host's `local_connection`); the edge cases; the Bridge criteria (one new: a stranger at the local port); four new TODO(verify). The channel design's text was removed; it remains in the benchmark, the note and the history.
- Sprints 115 and 116: all nine tasks are back in `backlog/`. Carried over with small edits: 115/t001 (dial), 115/t003 (address rule), 116/t004 (no password in the dial answer). Rewritten: 115/t002 (now the proxy in the `net` crate, and the move of the channel-only modules into the benchmark; renamed `task-002-net-proxy.md`), 115/t004 (a small wrapper; renamed `task-004-host-proxied-transport.md`), 116/t001 (one command; renamed `task-001-app-transport-open.md`), 116/t002, 116/t003, 116/t005 (a seventh run for the local port).
- Sprint 117: t001 gained the frozen-daemon case and the page's reaction to a network signal (both left open by 114/t004); t003 gained the firewall and security-software observation.
- `swe/sprints/PLAN.md`, `swe/MAIN-SCOPE.md`, `docs/desktop-client-handoff.md`, `swe/notes/desktop-ipc-benchmark.md` (the verdict names the decision) and the note at the top of `swe/architecture/ssh-gateway-connections.md` (no forwarded port; the page's leg is the same short-lived loopback listener) agree.

## Proposals, all accepted by the owner on 2026-11-22
| # | Proposal |
|---|---|
| P11 | One listener per connection, closed at the page's upgrade or after 10 s; single-use token; `Origin` and `Host` checks |
| P12 | Rust dials the daemon before it answers, so a failed dial is the command's error with its real reason |
| P13 | The page's leg carries no secret; the token is never logged |
| P14 | Memory marks: B4 becomes "no more than the baseline in the same run, plus 64 MiB"; the bridge criterion bounds what Rust holds (1 MiB) and reports the app's growth |
| P15 | A page that stops reading is not protected (the webview buffers, as today); Rust's hold is bounded |
| P16 | The benchmark keeps its channel candidates; `codec`, `window` and `order` move from the `net` crate into the benchmark |

## Acceptance criteria
- [x] The owner's choice is recorded in the spec's decisions with its date (T5).
- [x] §§ 2–3 describe the chosen design and nothing of the dropped one remains as current (a search for `seq`, `transport_ack`, `transport_send`, `handle` finds only history).
- [x] Every task of sprints 115 and 116 is rewritten or carried over, `PLAN.md` agrees (task counts unchanged: 4 and 5), and none is left in `blocked/`.

## Follow-ups / TODO(verify)
- Not measured, only read: the bearer subprotocol on the daemon's leg and its echo not being passed back, the `Host` check, TLS on the daemon's leg, the 128 MiB cap.
- Security software and a later webview restricting loopback: spec § TODO(verify); the manual checks of sprint 117 look for a prompt.
- If P14 is accepted, the benchmark's memory rule (`page/compare.js`) changes at its next run; no task holds that yet.
- Nothing of the proxy is built. Building starts with sprint 115 on the owner's word.
