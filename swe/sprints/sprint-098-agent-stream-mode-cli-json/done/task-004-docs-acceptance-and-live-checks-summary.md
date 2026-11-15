# Task 004 — Stream mode and CLI: documents, spec close, live checks — Summary

- **Sprint:** sprints/sprint-098-agent-stream-mode-cli-json
- **Completed:** 2026-11-15
- **Status:** done

## What was implemented
**Documents** (a docs subagent plus the orchestrator): `swe/features/timeline-streaming.md`, `swe/features/daemon-status-rpc.md`, `swe/architecture/websocket-protocol.md` (the `hello` sketch and the `agentStreams` rules), `swe/features/cli.md` (task-003), root `AGENTS.md` (sprint-098 bullet), `packages/{protocol,server,client,cli}/AGENTS.md`, `packages/{server,client,cli}/README.md`, the fixtures `README.md`/`CHANGELOG.md`, `docs/desktop-client-handoff.md` (the `hello` rules, how a quiet connection learns turn end and needs-input, the CLI JSON for daemon supervision, status/plan tables, fixture count 84, live figures). The spec's status line is "shipped", every acceptance criterion is ticked (with how it was proven), § 3 and its error table carry the `no_keypair` decision, and `MAIN-SCOPE.md` and `PLAN.md` agree.

**Live checks** (isolated production daemon, own `PI_STUDIO_HOME`/port, mock provider; scripts outside the repository, deleted):
| Check | Result |
|---|---|
| Production daemon advertises `agentStreamsMode` | yes |
| Quiet connection (`agentStreams: "none"`, `platform: "desktop"`) starts a `#tool shell` turn itself | 0 `agent_stream` frames; `agent_update` `running` and `idle` received |
| Normal connection, same turn | 9 stream frames (`user_message`, `turn_started`, `tool_call` incl. partials, `assistant_message`, `turn_completed`) |
| `fetch_agent_timeline_request` from the quiet connection | 5 stored rows, including the `tool_call` |
| `daemon_status` | `agentStreams: "none"` and `platform: "desktop"` for the quiet client; no `agentStreams` key for the other |
| `hello` with `agentStreams: "some"` | handshake succeeds |
| CLI on a scratch home, port 6871 (`pi-studio --json …`) | `pair` before any daemon `{"error":"no_keypair"}` exit 1; `start` `started:true`; second `start` `started:false`, exit 0; `pair` `{pairingUrl, relay:null}`; `status` unchanged shape; `restart` one line `started:true`; `stop` `{"stopped":true}`; second `stop` `{"stopped":false}` exit 1. Every output was one parseable line with nothing on stderr; the daemon was gone afterwards. |

Not run: a real Pi provider turn, the relay transport live (unit-covered), `daemon start --json` with a healthy daemon and no key file (unit-covered; needs a daemon started under another home).

## Files created / changed
Documents above; no code.

## Build & test results
See the sprint gate in the final report: `npm run build`, `typecheck`, `lint`, `npm test` on the final tree.

## Acceptance criteria
- [x] Every acceptance criterion in the spec is ticked, with how it was proven.
- [x] `docs/desktop-client-handoff.md` matches the repository after sprints 097 and 098.
- [x] Status line, `MAIN-SCOPE.md` row and `PLAN.md` agree the scope shipped.
- [x] Each live check was run, or named above as not run with the reason.
- [x] Gate green (below).

## Follow-ups / TODO(verify)
- Real Pi turn and live relay for the stream mode; out-of-tree readers of `transferToken` (carried in the spec's TODO list and `MAIN-SCOPE.md`).
