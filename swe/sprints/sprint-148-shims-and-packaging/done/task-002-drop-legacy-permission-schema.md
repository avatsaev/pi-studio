# Task 002 — Drop `legacyRespondToPermissionSchema` from the protocol

- **Sprint:** sprints/sprint-148-shims-and-packaging
- **Status:** done
- **Type:** refactor
- **Area:** packages/protocol
- **Priority:** P3
- **Estimated size:** XS
- **Depends on:** sprint-147/task-001

## Goal
The protocol carries no schema from the permission system retired on 2026-11-13.

## Context / why
Owner decision 2026-11-24 (approved shim drop). Depends on sprint-147/task-001, which may edit
`messages.ts` too.

## Scope references
- `docs/daemon-audit-handoff.md` § Decisions → Compatibility shims
- `packages/protocol/src/messages.ts` (`legacyRespondToPermissionSchema` near line 444, its entry in
  the session union near line 2232), `packages/protocol/src/session-messages.test.ts`
- `packages/protocol/AGENTS.md` (its row)
- `packages/protocol/fixtures/external-clients/`

## What to build
Delete the schema, its union entry, its tests and its docs row. If a fixture names the message, follow
the fixture procedure (edit, `formatVersion` bump, dated `CHANGELOG.md` entry); none did on 2026-11-24.

## Acceptance criteria
- [ ] No `legacyRespondToPermission` anywhere in `packages/`.

## Test / verification plan
- `npx vitest run packages/protocol/src`
- `npm run build:protocol`
