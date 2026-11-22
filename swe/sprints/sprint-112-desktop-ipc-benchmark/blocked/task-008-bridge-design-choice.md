# Task 008 — Choose the bridge design, respecify § 2–3, replan sprints 115 and 116

- **Sprint:** sprint-112-desktop-ipc-benchmark
- **Status:** blocked
- **Type:** design
- **Area:** swe/features, swe/sprints
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** task-007

## Goal
The owner has chosen how Rust and the page exchange a connection's frames, the spec's § 2–3 describe that design, and the tasks of sprints 115 and 116 are rewritten for it and back in `backlog/`.

## Context / why
The gate failed (task-007): Tauri's channel is too slow on Windows and can lose a message silently. Decision T3 says another design is explored before anything of the bridge is built. The comparison T3 asks for is done for one candidate: a loopback WebSocket proxy owned by Rust was added to the benchmark and measured on all three platforms (`swe/notes/desktop-ipc-benchmark.md`).

## Scope references
- `swe/notes/desktop-ipc-benchmark.md` § Verdict, § Each gated row, § What the loopback proxy costs, § Proposal to the owner
- `swe/features/desktop-transport-bridge.md` § 1 (Result), § 2, § 3, decisions T3, P1, P2
- `desktop/apps/ipc-bench/src/proxy.rs`, `page/transport.js` (the measured candidate)
- The blocked tasks of sprints 115 and 116 (each carries what is expected of it under the proxy)

## What to build
- The owner's choice among: the loopback proxy on all three platforms (proposed); the batched channel everywhere; the channel on macOS and Linux with the proxy on Windows; or a measurement on real machines first.
- The owner's word on two marks: B4 memory growth (the baseline misses it; proposed "no more than the baseline in the same run, plus 64 MiB") and T3's "a socket left in the webview is not the fallback" (the proxy keeps a webview socket to loopback only).
- For the design chosen: rewrite spec § 2 (the page's commands) and § 3 (the channel), the affected acceptance criteria and error cases; say how the password stays out of the page (Rust adds the bearer subprotocol on the upstream leg) and what a blocked page does to the daemon.
- Rewrite the tasks of sprints 115 and 116 (and what sprint 117 checks), update `PLAN.md`, and move them to `backlog/`.
- If the proxy is chosen: decide the listener's lifetime (per connection, as measured, or per launch), the token's delivery, the `Origin` and `Host` checks, and whether the SSH note's "no local port" (`swe/architecture/ssh-gateway-connections.md`) is changed to this short-lived one.

## Out of scope
- Building any part of the bridge.
- A new benchmark run, unless the owner asks for one (a streamed custom-scheme response was not measured; a real Windows machine was not measured).

## Acceptance criteria
- [ ] The owner's choice is recorded in the spec's decisions with its date.
- [ ] § 2–3 of the spec describe the chosen design and nothing of the dropped one remains as current.
- [ ] Every task of sprints 115 and 116 is rewritten or dropped, `PLAN.md` agrees, and none is left in `blocked/` for this reason.

## Test / verification plan
- No gate command: documents only.

## Notes
- The benchmark application keeps all four transports, so a later run compares them again without new code.

## Blocker
Needs the owner's choice of design. The question was put on 2026-11-21 with the numbers; the owner asked for explanations and has not chosen yet. Unblock when the owner names the design.
