# Task 007 — Host guard test, recording test host, and host acceptance

- **Sprint:** sprint-093-workbench-host
- **Status:** backlog
- **Type:** test
- **Area:** packages/workbench (host, test)
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-002, task-003, task-004, task-005, task-006

## Goal
Lock the seam: a test that fails when browser APIs creep back in, a reusable recording host, and the spec's host acceptance criteria run end to end.

## Context / why
Without a guard the seam erodes with the next feature. The recording host is also what the desktop repository's tests will copy.

## Scope references
- `swe/architecture/workbench-host-adapter.md` § Acceptance criteria, § TODO(verify)
- `packages/workbench/src/host/`
- `packages/workbench/src/test/` (test helpers)
- `packages/workbench/src/design-tokens.test.ts` (source-scan test precedent)

## What to build
- A source-scan test over the workbench's non-test sources, excluding the browser host implementation, that fails on: `localStorage`, `sessionStorage`, `navigator.clipboard`, `window.confirm`, `window.alert`, `window.prompt`, `window.location`, `window.history`, `window.open`, `import.meta.env`, `?worker`, `new WebSocket(`. It must also prove it scans a non-trivial number of files.
- `createTestHost()` in the test helpers: in-memory storage, recorded calls for every member, scriptable dialog answers, a controllable deep-link subject and resume signal.
- Run each acceptance criterion of the host spec and tick it in the spec file. Resolve or rewrite its `TODO(verify)` entries with what was observed (StrictMode-safe installation; drag-and-drop upload sources).
- Full gates.
- Keep `docs/desktop-client-handoff.md` current: update whatever this task makes stale there (status table, workbench and host sections, wire facts, milestones, open questions). Say in the summary what changed in it, or that nothing did.

## Out of scope
- Verifying Tauri behaviour: that belongs to the desktop repository.

## Acceptance criteria
- [ ] The guard test passes and fails when a forbidden token is added to a feature file (shown once, then reverted).
- [ ] `createTestHost()` exists and is used by the host tests written in tasks 001–006.
- [ ] Every acceptance criterion in the host spec is ticked or has a written reason.
- [ ] `npm run build && npm run typecheck && npm run lint && npm test` pass.
- [ ] `docs/desktop-client-handoff.md` matches the repository after this task, or the summary states that nothing in it was affected.

## Test / verification plan
- `npx vitest run packages/workbench`
- Full gates as listed.

## Notes
- Comments and documentation strings mention some of these tokens legitimately (for example the HTML sandbox notes on `localStorage`). The scan must ignore comments or allow-list those lines explicitly, each with a reason.
