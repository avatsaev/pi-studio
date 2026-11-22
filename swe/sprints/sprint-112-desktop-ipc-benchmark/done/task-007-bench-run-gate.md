# Task 007 — Run the benchmark on three platforms, write the note, state the gate

- **Sprint:** sprint-112-desktop-ipc-benchmark
- **Status:** done
- **Type:** test
- **Area:** swe/notes, swe/features
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-001, task-006

## Goal
The note holds the results for Linux, macOS and Windows, and says whether the gate passed and with which encoding.

## Context / why
T3: this result decides whether sprints 115 and 116 are built as specified. A pass fixes the channel's encoding; a failure stops the bridge until another design is accepted by the owner.

## Scope references
- `swe/features/desktop-transport-bridge.md` § 1 (pass marks, outcome, "If it fails"), § 3 (the encoding is the benchmark's result), decisions T3, P1, P2, P7
- `swe/notes/desktop-ipc-benchmark.md` (task-001 started it)
- `swe/sprints/PLAN.md`, `docs/desktop-client-handoff.md` § Open questions

## What to build
- Run at full scale: Linux in the container and, if a display is available, on the machine itself; macOS and Windows through the workflow.
- The note: per platform, every row for the baseline and each variant (the worst of three runs, with the three values), the webview and Tauri versions, the IPC path, the out-of-order count, and the machine.
- A verdict per gated row against P1, then one line: passed with variant X, or failed on rows Y.
- A row that fails only on a runner, within 20 % of its mark: ask the owner to run the artifact on a real machine before calling the gate failed.
- On a pass: the spec's § 3 names the encoding, and the handoff's open question about IPC speed is answered with the numbers.
- On a failure: every task of sprints 115 and 116 moves to `blocked/` with a Blocker note naming the rows, and a design task is added (compare a loopback WebSocket with a per-launch token and a streamed custom-scheme response in the same application, propose one to the owner).
- What B8 showed about worker timers, as a recommendation on P7.

## Out of scope
- Building any part of the bridge.
- Changing a pass mark: propose it to the owner with the numbers.

## Acceptance criteria
- [ ] The note has all three platforms with every row and the versions.
- [ ] The gate is stated as passed or failed, and the spec, `PLAN.md` and the handoff agree with it.
- [ ] On a failure, the tasks of sprints 115 and 116 are in `blocked/` and the design task exists.

## Test / verification plan
- The workflow run's URL and the Linux `results.json` are attached to the summary.
- No gate command: this task changes documents only.

## Notes
- The runs on runners are virtual machines with shared CPUs: three runs, the worst counts, and say which numbers varied by more than 20 % between runs.
- The owner has a Mac and a Windows machine and offered to test builds: an artifact of the benchmark is the easiest thing to hand over.
