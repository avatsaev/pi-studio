# Task 006 — Sprint close: docs, spec amendments, gates

- **Sprint:** sprint-084-daemon-status-rpc
- **Status:** done
- **Type:** docs
- **Area:** AGENTS.md (server, protocol); swe
- **Priority:** P2
- **Estimated size:** XS
- **Depends on:** task-001…task-005

## Goal

The status family is documented as registered but unadvertised until sprint-085, and the spec
records the planning and implementation answers.

## What to build

- `packages/server/AGENTS.md`: an "Observability" subsystem section covering the service, the
  sampler, the timer lifecycle, the `Session` metadata, `version.ts`, and "not advertised until
  `daemonObservability` (s085)".
- `packages/protocol/AGENTS.md`: the `daemon_status_*` schemas.
- `features/daemon-status-rpc.md`: resolve the TODO(verify) items:
  - `list()` excludes archived;
  - the relay close path finding;
  - the `startedAt` definition;
  - the `clients[]` cap decision;
  - the baseline alignment;
  - the `Session` defaults.
  Also record the refinements: no `curated-packs` re-export; the flag moves to s085.
- Fixtures are **not** added here. They land with the flag in s085/t005, since a fixture declares
  `requiresFeature: "daemonObservability"`.

## Acceptance criteria

- [ ] Gates are green: `npm run build`, `npm run typecheck`, `npm run lint`, `npm run fmt:check`,
  `npm test`.

## Test / verification plan

- Full gates.
