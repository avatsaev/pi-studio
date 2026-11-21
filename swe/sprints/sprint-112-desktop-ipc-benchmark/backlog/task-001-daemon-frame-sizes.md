# Task 001 — Measure what a daemon sends: frame sizes of a terminal flood, the largest frames

- **Sprint:** sprint-112-desktop-ipc-benchmark
- **Status:** backlog
- **Type:** test
- **Area:** packages/client (a throwaway script), swe/notes
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** none

## Goal
The benchmark note opens with measured facts about real traffic: the sizes and rate of a flooding terminal's frames, and the largest frames seen in each direction.

## Context / why
The thresholds of the benchmark (P1) were derived, not measured. Row B2 guesses 4 KiB and 64 KiB frames for a flood, and the 128 MiB message cap is a guess above the `ws` library's default. Both are open in the spec's TODO(verify). The daemon coalesces terminal output for 4 ms (`packages/server/src/terminal/terminal-manager.ts`), and file transfers use 32 KiB chunks.

## Scope references
- `swe/features/desktop-transport-bridge.md` § 1 (rows B2–B4), § 2 (the 128 MiB cap), § TODO(verify) ("The numbers of P1", "Largest frame either side sends")
- `packages/client/src/daemon-client.ts`, `packages/client/src/pistudio-client.ts` (the SDK the script uses)
- `packages/server/src/terminal/terminal-manager.ts` (coalescing), `packages/server/src/files/file-transfer.ts` (chunk size)
- `swe/notes/desktop-ipc-benchmark.md` (created here)

## What to build
- A throwaway Node script that connects to a dev daemon with the SDK (a scratch `PI_STUDIO_HOME`, a free port, never 6767), wraps the transport's `onMessage` and `sendText`/`sendBinary`, and records the size of every frame with a timestamp.
- Three recordings: a terminal that prints about 100 MiB as fast as it can; a file download and an upload of 256 MiB; a session with a long timeline fetched page by page (the mock provider's `#tool` and `#stream` prompts make one without credentials).
- For each: frames per second, and the minimum, median, 99th percentile and maximum frame size, per direction and per kind (text, binary).
- `swe/notes/desktop-ipc-benchmark.md` with a first section, "What a daemon sends", holding those tables, the machine, the daemon version and the commands used.
- The script is deleted at the end; the summary keeps how it was run.

## Out of scope
- Changing any threshold: propose it in the summary; the orchestrator edits the spec.
- Anything about Tauri or the desktop app.

## Acceptance criteria
- [ ] The note has the three tables with real numbers and names the commands that produced them.
- [ ] The summary states whether B2's frame sizes (4 KiB, 64 KiB) match the flood's median and 99th percentile, and proposes others if not.
- [ ] The summary states the largest text and binary frame seen and which request produced it, and whether 128 MiB leaves room.
- [ ] No source file under `packages/` is changed; the script is gone from the tree.

## Test / verification plan
- Run the script against `npm run dev:daemon` (set `PI_STUDIO_LISTEN` to a free port); attach its output to the summary.
- `git status` shows only the note.

## Notes
- The dev daemon serves terminals with real PTYs and file transfer, so no production daemon is needed.
- A flood's rate depends on the machine: record the CPU and whether the daemon and the script share it.
