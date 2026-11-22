# Task 002 — Documents and spec close for milestone 4

- **Sprint:** sprint-130-desktop-relay-ssh-close
- **Status:** in_progress
- **Type:** docs
- **Area:** swe/, docs/, desktop/AGENTS.md, desktop/docs/architecture.md
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** sprint-129/task-004

## Goal
Every document the spec lists as changing tells the truth about what was built.

## Context / why
§ Dependencies on other specs.

## Scope references
- `swe/features/desktop-relay-ssh.md` § Dependencies on other specs, status line, criteria
- `docs/desktop-client-handoff.md`, `swe/MAIN-SCOPE.md`, `swe/sprints/PLAN.md`

## What to build
- Amend `desktop-transport-bridge.md` (T1 ends, `transport_open`, `ui.inspect`, codes, CSP), `desktop-daemon-registry.md` (version 3, `ssh`, commands, surfaces, no link to the page), `desktop-transfer-engine.md` (D2 ends, connector type, codes), `workbench-host-adapter.md`, `ssh-gateway-connections.md` (superseded), `desktop/AGENTS.md` (rule 10 without exception, layer table, where sockets live), `desktop/docs/architecture.md`.
- Spec status and ticks; handoff and MAIN-SCOPE state; PLAN close note.

## Out of scope


## Acceptance criteria
- [ ] No document says a relay entry uses the page's socket or that a command returns the link.

## Test / verification plan
- `grep -rn "not_bridged\|webview's own socket" swe docs desktop` finds only history

## Notes

