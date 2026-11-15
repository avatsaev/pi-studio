# Task 004 — Stream mode and CLI: documents, spec close, live checks

- **Sprint:** sprint-098-agent-stream-mode-cli-json
- **Status:** done
- **Type:** docs
- **Area:** docs, swe specs, package documents; live verification
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-001, task-002, task-003, sprint-097/task-007

## Goal
The follow-ups II scope is closed: every document matches the code, every acceptance criterion of the spec is ticked or explained, and the two features of this sprint are proven against a production daemon.

## Context / why
Sprint 097 closed the download half. This task closes the rest and the scope as a whole, and leaves `docs/desktop-client-handoff.md` as the desktop repository's accurate brief for the wire it will implement.

## Scope references
- `swe/features/desktop-client-protocol-followups-2.md` § Acceptance criteria (all groups), § TODO(verify)
- `swe/features/timeline-streaming.md` ("broadcast to subscribed clients"), `swe/features/cli.md` (`daemon` group), `swe/features/daemon-status-rpc.md` (client entries)
- `AGENTS.md` (root, § Protocol overview: `hello` fields, feature flags), `packages/protocol/AGENTS.md`, `packages/server/AGENTS.md`, `packages/client/AGENTS.md`, `packages/cli/AGENTS.md`, `packages/protocol/fixtures/external-clients/README.md`
- `docs/desktop-client-handoff.md`
- `swe/MAIN-SCOPE.md` (the spec's index row and its TODO(verify) entry), `swe/sprints/PLAN.md`
- `swe/av-swe.config.json` § `gateNotes.liveChecks`

## What to build
Documents:
- `swe/features/timeline-streaming.md`: stream events go to sessions whose mode is `"all"`.
- `swe/features/cli.md`: the JSON output of `daemon start`, `restart`, `pair`, `stop`.
- `swe/features/daemon-status-rpc.md`: `agentStreams` on client entries.
- Root and package `AGENTS.md` files: `hello.agentStreams`, `agentStreamsMode`, the SDK option, the CLI shapes.
- `docs/desktop-client-handoff.md`: the `hello` rules (`agentStreams`), how the Rust-owned connection learns "turn ended" and "needs input" without the stream, the CLI's JSON for daemon supervision, the status and plan tables, the open questions this scope answered.
- The spec: status line to shipped, every acceptance criterion ticked or annotated with why not, the TODO(verify) list resolved or carried.
- `swe/MAIN-SCOPE.md` and `swe/sprints/PLAN.md`: status of the spec row, sprints 097 and 098 marked done.

Live checks, run in the orchestrator against an isolated production daemon (its own `PI_STUDIO_HOME` and port):
- two connections, one with `agentStreams: "none"`, during a real turn: the quiet one receives `agent_update` and no `agent_stream`, and `daemon_status` shows its mode;
- `pi-studio daemon start --json`, `pair --json`, `stop --json` and `restart --json` on a scratch home: one parseable line each, including `started: false` on a second start.

## Out of scope
- Anything in the desktop repository.
- The relay multi-client work (`swe/grills/relay-multi-client.md`), which has its own scope.

## Acceptance criteria
- [ ] Every acceptance criterion in the spec is ticked, or carries a note saying what was not done and why.
- [ ] `docs/desktop-client-handoff.md` matches the repository after sprints 097 and 098.
- [ ] The spec's status line, its `MAIN-SCOPE.md` row and `PLAN.md` agree that the scope shipped.
- [ ] Each live check above was run and its result recorded, or the summary names the one that could not be run and why.
- [ ] `npm run build`, `npm run typecheck`, `npm run lint` and `npm test` pass.

## Test / verification plan
- `npm run build && npm run typecheck && npm run lint && npm test`
- Live checks as listed; keep the scripts out of the repository.

## Notes
- The detailed turn outcome (`turn_completed`, `turn_failed`, `turn_canceled`) exists only in the stream and in fetched history. Say so in the handoff document: a quiet connection that needs it fetches the timeline.
- A release publishes on every push to `main`. Merging this branch is the engineer's call; do not push to `main` from this task.
