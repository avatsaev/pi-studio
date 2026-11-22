# Task 001 — Measure what a daemon sends — Summary

- **Sprint:** sprints/sprint-112-desktop-ipc-benchmark
- **Completed:** 2026-11-21
- **Status:** done

## What was implemented
`swe/notes/desktop-ipc-benchmark.md`, section "What a daemon sends": setup, commands, tables for a terminal flood (100 MiB), a 256 MiB file transfer each way, and a long timeline, plus the largest frames. The throwaway script was kept under `/tmp` and deleted; the dev daemon ran on a free port with a scratch home and was removed. Nothing under `packages/` changed.

## Measured (Ryzen 9 9955HX, Node 24.22.2, daemon and client sharing the CPU, one run per recording, mock provider)
| Recording | Frames | Median | p99 | Max |
|---|---|---|---|---|
| Terminal flood, daemon to client, binary | 301 at 168/s | 362,398 B | 487,433 B | 553,220 B |
| File transfer, either direction, binary | 8,194 each way | 32,770 B | 32,770 B | 32,770 B |
| Timeline pages (limit 50), text | 53 | 10,966 B | 11,042 B | 11,042 B |

Largest text frame: 5,243,061 B (a 5 MiB `file_read_request`); without that probe 551,972 B (one-shot timeline). The client's largest: 215 B text, 32,770 B binary. 128 MiB leaves ample room.

## Acceptance criteria
All four met (note with real numbers and commands; B2's sizes judged; largest frames stated; tree clean).

## Spec and plan effects (applied by the orchestrator)
B2 gained a 256 KiB size (a flood arrives at about 350 KiB, not 4 or 64 KiB); the 128 MiB cap stands; two TODO(verify) items answered in the spec.

## TODO(verify)
One run per recording; small mock rows only (a real session with large tool outputs or 10^4-10^5 rows was not measured); frame size depends on PTY speed and the consumer.
