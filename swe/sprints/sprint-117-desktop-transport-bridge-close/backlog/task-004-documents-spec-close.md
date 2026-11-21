# Task 004 — Documents and spec close for milestone 2

- **Sprint:** sprint-117-desktop-transport-bridge-close
- **Status:** backlog
- **Type:** docs
- **Area:** desktop/, docs/, swe/, AGENTS.md
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-001, task-002

## Goal
Every document describes the app as it now is, and the spec says what was built and what is still open.

## Context / why
The repository's rule: documents change with the code. Several still say the webview opens the socket and that secrets are in `daemons.json`.

## Scope references
- `swe/features/desktop-transport-bridge.md` (status, criteria, TODO(verify))
- `swe/features/desktop-daemon-registry.md` (the amended sections)
- `swe/architecture/workbench-host-adapter.md`
- `desktop/AGENTS.md`, `desktop/README.md`, `desktop/docs/architecture.md`, `desktop/docs/development.md`, `desktop/docs/control-protocol.md`
- `docs/desktop-client-handoff.md`, `AGENTS.md` (root, the `desktop/` paragraph), `swe/MAIN-SCOPE.md`, `swe/sprints/PLAN.md`

## What to build
- The spec: status, each criterion ticked with its evidence or left open with the reason, each TODO(verify) answered or carried forward.
- `desktop/AGENTS.md`: "Where it stands", rule 10 (where secrets live, which secret still reaches the page), the workspace map with the two new crates.
- `desktop/docs/architecture.md`: the layer table, the command table, the Content-Security-Policy note (why `ws:` stays), secrets, threads, "What stays out of the core", and the decisions made on the way.
- The handoff: milestone 2's state, and what milestone 3 and milestone 4 can now build on.
- The root `AGENTS.md` paragraph on `desktop/` and the index row in `MAIN-SCOPE.md`.
- A decision on the desktop version for the release that carries this (the app is 0.1.0).

## Out of scope
- Releasing: tagging `desktop-v<version>` needs the owner's word.
- New behaviour.

## Acceptance criteria
- [ ] No document says the webview opens the socket for a local or direct entry, or that a secret is in `daemons.json`, except where it describes history.
- [ ] The spec's open items match the summaries of the tasks that left them open.
- [ ] `cargo xtask ci` passes; the root `npm run lint` passes.

## Test / verification plan
- `cargo xtask ci` in `desktop/`
- `rg -n "still opens the WebSocket|live only in .daemons.json" desktop docs AGENTS.md swe/features` finds only history.

## Notes
- Write only what the code does now; an open item is named as open.
