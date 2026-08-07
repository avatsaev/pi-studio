# Task 003 — Shared validation conventions + base types

- **Sprint:** sprint-001-foundation
- **Status:** done
- **Estimated size:** XS
- **Depends on:** task-001

## Goal
Codify the project-wide Zod validation conventions and a tiny set of shared base types/helpers used
at every wire and disk boundary.

## Scope references
- `clean-room-scope/MAIN-SCOPE.md` § 9 (Cross-Cutting Conventions)
- `clean-room-scope/architecture/persistence.md` § Public Contract / Behavior
- `clean-room-scope/architecture/websocket-protocol.md` § Compatibility rules

## What to build
- A small shared module (in `protocol`) with Zod helpers and the **append-only compatibility**
  conventions encoded as guidance + lint-checkable patterns:
  - New fields optional with defaults/transforms; never flip optional→required; never remove or
    narrow types.
  - `COMPAT(name)` tag convention (version added + removal date) for back-compat shims.
- Shared primitive schemas: ISO-8601 timestamp string, UUID, base64url id helpers.
- A `safeParseOrDefault(schema, value, defaults)` helper used by stores.

## Out of scope
- Actual message/store schemas (later sprints).

## Acceptance criteria
- [ ] A documented convention file/module exists describing append-only rules and `COMPAT(name)`.
- [ ] `safeParseOrDefault` returns defaults on invalid input and parsed value on valid input.
- [ ] Shared primitive schemas validate/reject representative inputs.

## Test / verification plan
- Tests: `npx vitest run <helpers test>` covering valid/invalid timestamp, uuid, and
  `safeParseOrDefault` fallback.

## Notes
- These helpers are the backbone of "validate at every boundary"; reused by persistence and protocol.
