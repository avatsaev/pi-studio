# Task 003 — Live checks on the compose stack and old versions; scope closed

- **Sprint:** sprint-101-relay-multi-client-close
- **Status:** done
- **Type:** test
- **Area:** docker/, workbench (browser), swe/
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-002

## Goal
The feature works in a real browser through the real relay, the rollout behaves as the spec says against a 0.0.120 daemon and tab, and the scope is marked built.

## Context / why
The last acceptance criterion is a live check on `docker/docker-compose.yml`. Several TODO(verify) items can only be closed against old versions running for real: S9, old-daemon pongs, an old tab parked.

## Scope references
- `swe/features/relay-multi-client.md` § Acceptance criteria (live check, old daemon, pairing link from before, offline message), § What a user sees during the rollout, § TODO(verify)
- `swe/architecture/relay-protocol.md` § TODO(verify) (S9, pong behaviour of old clients)
- `docker/docker-compose.yml`, `docker/README.md`

## What to build
Run and record, in the orchestrator's session (ports and a browser):
1. `cd docker && docker compose up --build`. Open two browser tabs on the pairing link through the relay. In both, run a terminal and a file upload and download at the same time; neither tab disconnects the other; `daemon_status` (Settings or CLI) shows two relay sessions.
2. Stop the daemon container: a tab reconnecting shows the `daemon_offline` message (offline or key replaced). Start it again: the tabs reconnect.
3. A pairing link printed before the stack was rebuilt (same daemon home) connects.
4. Restart the relay: daemon and tabs come back without a redial storm in the daemon log (backoff visible).
5. Old versions: run a 0.0.120 daemon (`npx @av-pi-studio/cli@0.0.120`, scratch home) against the new relay. It stays connected for over 2 minutes without redialing (pings answered). The new web client reaching it shows `daemon_outdated`. Then open a 0.0.120 web client (that version's `pi-studio ui`) against an updated daemon: it stays on "connecting". With only that tab parked and the updated daemon stopped, a new client gets `daemon_offline`, not `daemon_outdated` (S9).
6. Tick the acceptance boxes in `relay-multi-client.md` and `relay-protocol.md` that the automated and live evidence covers, citing the test or step. Set both specs' status to built, with the release. Update each TODO(verify) item that the checks closed. Add the decisions to the grill's round log if anything changed.

## Out of scope
- Production deployment (the release pipeline, D21). Merging to `main` publishes and deploys: merge only when the owner says so.

## Acceptance criteria
- [ ] Steps 1–5 are done, with screenshots or log excerpts in the summary.
- [ ] Every acceptance box in both specs is ticked with its evidence, or left open with the reason.
- [ ] `swe/sprints/PLAN.md` marks sprints 099–101 done with the live-check line, like sprint-098's row.

## Test / verification plan
- Full gates once: `npm run build && npm run typecheck && npm run lint && npm run fmt:check && npm test`.
- The live steps above.

## Notes
- If S9 has not been confirmed by the owner by now, say so in the summary. Step 5 still runs, because it tests the code as built.
- Old-version runs use scratch homes and non-default ports. Never touch the user's own daemon on :6767.
