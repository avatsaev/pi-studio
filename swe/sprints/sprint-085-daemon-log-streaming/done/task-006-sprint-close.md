# Task 006 — Sprint close: combined cost check, docs, spec amendments, gates

- **Sprint:** sprint-085-daemon-log-streaming
- **Status:** done
- **Type:** docs
- **Area:** AGENTS.md (root, server, protocol); fern; swe
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-001…task-005

## Goal

The observability API (status + logs) ships documented, with its combined cost measured.

## What to build

- Combined cost check: one subscriber on status and logs, a steady 200 lines/s of logging, and 500
  mock agents, run for 60 s of real time on the dev daemon. Report CPU against the < 1 % of one core
  budget (D33). If it is over, record it as a finding for the summary; do not tune silently.
- Docs:
  - root `AGENTS.md` § Protocol overview: one bullet for `daemon_status_*` / `daemon_logs_*` /
    `daemonObservability`, covering the read-only, authenticated-only, per-session push with no
    broadcast, the 5 s interval, the 1000-line ring, the 200 lines/s cap and `dropped`, the
    injected-logger empty stream, and "file output unchanged";
  - `packages/server/AGENTS.md`: observability section extended with the tap and the logs service;
  - `packages/protocol/AGENTS.md`: the flag and schemas;
  - fern daemon-configuration page: one paragraph saying a remote client can stream logs and that
    redaction is best-effort. No new env var.
- Specs: Status shipped for both features. Resolve the log-streaming TODO(verify) items:
  - pino writes one line per write;
  - the tap-before-logger order;
  - the sanitizer key list and `tokens`;
  - ring memory;
  - relay disposal, shared with s084/t003.
  Mark the MAIN-SCOPE rows shipped (sprint-084/085).

## Acceptance criteria

- [x] Every acceptance criterion of both specs is checked off with evidence (test name or recorded
  observation).
- [x] Gates are green: `npm run build`, `npm run typecheck`, `npm run lint`, `npm run fmt:check`,
  `npm test`.

## Test / verification plan

- Cost run as above, plus the full gates.
