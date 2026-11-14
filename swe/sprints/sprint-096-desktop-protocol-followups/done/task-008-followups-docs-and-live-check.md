# Task 008 — Follow-ups close: documentation and live checks

- **Sprint:** sprint-096-desktop-protocol-followups
- **Status:** done
- **Type:** docs
- **Area:** docs, packages/*/AGENTS.md, swe/
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-001, task-002, task-003, task-004, task-005, task-006, task-007

## Goal
Close the follow-ups: every document current, every spec criterion checked against a running system.

## Context / why
These changes exist for the desktop agent. They are finished when the handoff document tells that agent exactly what the wire now does.

## Scope references
- `swe/features/desktop-client-protocol-followups.md` § Acceptance criteria, § TODO(verify)
- `docs/desktop-client-handoff.md` (§ Status, § What to build in Rust steps 1–2, § Compatibility rules, § Open questions)
- Root `AGENTS.md` § Protocol overview
- `packages/{protocol,client,server}/AGENTS.md`
- `swe/MAIN-SCOPE.md` § 8, § 10

## What to build
- `docs/desktop-client-handoff.md`: replace every "today" statement the follow-ups changed (handshake platform field, upload completion signal, pacing, download error behaviour, stream ownership, fixture coverage including binary frames); move resolved items out of "Open questions"; state the first version that carries each change.
- Root `AGENTS.md`: a protocol-overview entry for the transfer acknowledgement and `hello.platform`; update the external-fixtures entry.
- Mark the follow-ups spec shipped; tick its criteria; resolve its `TODO(verify)` list in the spec and in `swe/MAIN-SCOPE.md` § 10.
- Live checks: the 500 MB upload from task-005; a large download to a throttled client; a `desktop`-platform session visible in `pi-studio daemon status` or the status RPC; the same against a relay connection where one is available.
- Full gates.
- Keep `docs/desktop-client-handoff.md` current: update whatever this task makes stale there (status table, workbench and host sections, wire facts, milestones, open questions). Say in the summary what changed in it, or that nothing did.

## Out of scope
- New protocol work.
- Anything in the desktop repository.

## Acceptance criteria
- [ ] Every criterion in the follow-ups spec is ticked or has a written reason.
- [ ] `docs/desktop-client-handoff.md` describes the wire as it is, with versions.
- [ ] All gates pass from a clean tree.
- [ ] The summary lists what the desktop agent can now rely on that it could not before.
- [ ] `docs/desktop-client-handoff.md` matches the repository after this task, or the summary states that nothing in it was affected.

## Test / verification plan
- `npm run clean && npm run build && npm run typecheck && npm run lint && npm run fmt:check && npm test`
- The live checks listed above.
