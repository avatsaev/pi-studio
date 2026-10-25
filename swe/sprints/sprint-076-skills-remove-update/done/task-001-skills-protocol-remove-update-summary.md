# Task 001 — Protocol: `skills_remove` and `skills_update_all` — Summary

- **Sprint:** sprint-076-skills-remove-update
- **Completed:** 2026-10-25
- **Status:** done

## What was done

Added the wire schemas for the sprint-076 `skills_*` remove/update-all pair, following the
sprint-075 `skills_list`/`skills_set_enabled` pattern exactly:

- `skillsRemoveRequestSchema` / `SkillsRemoveRequest` — `type`, `requestId`, optional `path` /
  `packageSource`, `.refine()`-enforced xor (exactly one of the two, never both, never neither).
  Because `sessionMessageSchema` is built with `z.discriminatedUnion`, which requires every member
  to stay a plain `ZodObject` (not the `ZodEffects` a `.refine()` wraps), the raw shape was split
  into an unexported `skillsRemoveRequestShapeSchema` used as the union member, with the exported,
  refined `skillsRemoveRequestSchema` layered on top for direct validation/tests.
- `skillsRemoveResponseSchema` / `SkillsRemoveResponse` — `{ok, error?, message?, stderr?, skills,
  packages}`; `stderr` carries the spawned `skills remove`/`pi remove` tail on a failed mutation.
- `itemResultSchema` / `ItemResult` — `{target, ok, error?, stderr?}`, shared by `results[]`.
- `skillsUpdateAllRequestSchema` / `SkillsUpdateAllRequest` — `{type, requestId}` (empty body).
- `skillsUpdateAllResponseSchema` / `SkillsUpdateAllResponse` — `{ok, error?, message?,
  results: ItemResult[], skills, packages}`.
- All four new request/response schemas registered in `sessionMessageSchema`'s discriminated
  union (the request using the unrefined shape schema as explained above).
- `.passthrough()` on every object; all response fields beyond the documented required ones are
  optional, matching the repo-wide forward-compat convention. `ok`/`error` remain domain fields,
  never `rpc_error`.
- Tests added in `session-messages.test.ts` (new `describe("skills remove / update_all
  (sprint-076/task-001)")` block): `itemResultSchema` round-trip, remove-request xor acceptance/
  rejection (both set, neither set, each alone), union-parse for all four new message types,
  unknown-error-string + `stderr` tolerance on the remove response, a mixed ok/failed
  `skills_update_all_response.results` array, and a passthrough round-trip for every new schema.
- `packages/protocol/AGENTS.md`'s `messages.ts` key-exports table updated with rows for
  `skillsRemoveRequestSchema`/`SkillsRemoveResponse`, `itemResultSchema`, and
  `skillsUpdateAllRequestSchema`/`SkillsUpdateAllResponse`, including a note on the
  shape-vs-refined-schema split.

## Files changed

| File | Change |
|------|--------|
| `packages/protocol/src/messages.ts` | New schemas/types for `skills_remove_*`, `item_result`, `skills_update_all_*`; registered in `sessionMessageSchema` union |
| `packages/protocol/src/session-messages.test.ts` | New imports + `describe("skills remove / update_all (sprint-076/task-001)")` test block |
| `packages/protocol/AGENTS.md` | Documented the four new exports in the `messages.ts` key-exports table |

## Build & test results

```
$ npx vitest run packages/protocol/src/session-messages.test.ts
 ✓ packages/protocol/src/session-messages.test.ts (76 tests) 11ms
 Test Files  1 passed (1)
      Tests  76 passed (76)

$ npx vitest run packages/protocol
 Test Files  10 passed (10)
      Tests  133 passed (133)

$ npm run build:protocol
> tsc -b packages/protocol
(clean, no output)

$ npx oxlint packages/protocol/src/messages.ts packages/protocol/src/session-messages.test.ts
(no output — clean)

$ npx oxfmt packages/protocol/src/messages.ts packages/protocol/src/session-messages.test.ts packages/protocol/AGENTS.md
Finished in 90ms on 2 files using 32 threads.
```

## Acceptance criteria checked

- [x] Remove with both or neither of `path`/`packageSource` is rejected
- [x] Update-all response with mixed ok/failed results parses

## Follow-ups

- None for this task. Server-side implementation (remove/update_all handlers, spawn plumbing,
  queue wiring) is sprint-076 task-004/task-005, out of scope here.
