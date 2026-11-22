# Task 004 — Benchmark: the bridge candidates (per-frame and batched channel, raw invokes with `seq`, acknowledgements)

- **Sprint:** sprint-112-desktop-ipc-benchmark
- **Status:** done
- **Type:** feature
- **Area:** desktop/apps/ipc-bench
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** task-002, task-003

## Goal
The benchmark runs rows B1–B6 over each candidate bridge beside the baseline, and records which IPC path the webview used.

## Context / why
The candidates are variants of the design in the spec's §§ 2–3. Tauri delivers a channel message under 1,024 raw bytes (8,192 for JSON) by evaluating a script and a larger one through an extra fetch, so per-frame and batched delivery may differ a lot; the measurement decides.

## Scope references
- `swe/features/desktop-transport-bridge.md` § 1 (candidates, the facts read in Tauri 2.12.5), § 2, § 3
- `desktop/apps/ipc-bench/` (task-002), `desktop/crates/net/` (task-003: codec, window, order buffer)
- `~/.cargo/registry/src/*/tauri-2.12.5/src/ipc/channel.rs`, `scripts/ipc-protocol.js` (how a channel and a raw invoke travel)

## What to build
- Rust side: a bridge mode in which Rust holds a client socket to the application's own server and forwards between it and the page: inbound over a `Channel`, outbound through commands. The commands are the benchmark's own, shaped like the spec's (`open`, `send_text`, `send_binary` with `handle` and `seq` headers, `ack`, `close`).
- Inbound variants: (a) one channel message per frame, raw for binary and JSON for text; (b) batches in the codec's format, flushed when 64 KiB is waiting or the read loop has nothing more to read.
- Outbound variants: (a) one invoke per frame; (b) frames queued in the same task batched into one raw invoke.
- The inbound window and the outbound order buffer from the `net` crate are in the path, with acknowledgements every 256 KiB or 50 ms.
- Page side: one transport implementation per variant behind the interface of task-002, so the workloads are shared. `bufferedAmount` as the spec defines it (added at send, subtracted at the answer).
- Recorded per run: whether a raw body reached Rust as bytes or as a JSON array (the `postMessage` fallback), and how many sends arrived out of `seq` order.
- A test mode in which the page never acknowledges, to show that Rust stops reading at the window.
- **Added at wave 1 (2026-11-21, from the measurements of s112/t001 and t002):** B2 also runs with 256 KiB binary frames (a real terminal flood arrives at a median of about 350 KiB; the baseline of task-002 has only 4 KiB and 64 KiB, so add 256 KiB to the baseline too); and the verdict on B1 uses the mean round trip where the webview's timer steps by 1 ms (WebKit does), as the spec's B1 row now says.

## Out of scope
- Rows B7 and B8 (task-005).
- TLS, passwords, error classes: the benchmark's socket is plain and local.

## Acceptance criteria
- [ ] `results.json` holds rows B1–B6 for the baseline and for each of the variant pairs, three runs each, in the container.
- [ ] B6 finds no reordered, lost or changed frame in any variant.
- [ ] Each run records the IPC path and the out-of-order count.
- [ ] In the no-acknowledgement mode the bytes Rust holds stop at 8 MiB and the server's sends stall.
- [ ] `cargo xtask ci` passes.

## Test / verification plan
- `cargo xtask ci` in `desktop/`
- Full-scale run in the container; attach `results.json` and a first reading of baseline against candidates to the summary.

## Notes
- Do not tune a variant for the Linux webview only: the same code runs on WKWebView and WebView2 in task-006.
- If a variant cannot keep order without the page-side reordering Tauri's channel already does, say so in the summary: that is a finding.
