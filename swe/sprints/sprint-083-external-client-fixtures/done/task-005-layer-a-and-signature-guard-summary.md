# Task 005 — Layer A: schema validation, manifest check, secret scan, signature guard — Summary

- **Sprint:** sprint-083-external-client-fixtures
- **Completed:** 2026-11-13
- **Status:** done

## What was implemented
- `packages/protocol/src/external-fixtures.test.ts` (62 tests): manifest ↔ directory equality; `response` pairing; fixture format + volatile pointers resolve; envelope parse via `topLevelEnvelopeSchema`; Zod parse via `sessionMessageSchema.optionsMap` (schema-less types skipped) and the top-level schemas; exceptions require a schema; secret scan; signature guard plus in-memory rule tests.
- `packages/protocol/scripts/external-fixtures-support.ts` (shared by the test and the update script; outside `src/`, not compiled or published) and `scripts/update-fixture-signatures.ts` → `npm run fixtures:update -w @av-pi-studio/protocol` (refuses an unacknowledged breaking change so regenerating cannot defeat the guard).
- `fixtures/external-clients/.signatures.json` (`pointer → JSON type` per fixture, with `formatVersion`).
- The signature guard compares removed/retyped pairs only; breaking changes pass only with a higher `formatVersion` AND a `CHANGELOG.md` mention of the file.
- Fixtures reformatted with oxfmt (arrays collapsed); `packages/protocol/AGENTS.md` documents the contract. npm `files` is changed in task-007.

## Files created / changed
| File | Change |
|------|--------|
| `packages/protocol/src/external-fixtures.test.ts` | created |
| `packages/protocol/scripts/external-fixtures-support.ts`, `update-fixture-signatures.ts` | created |
| `packages/protocol/fixtures/external-clients/.signatures.json` | created; other fixtures oxfmt-only whitespace |
| `packages/protocol/package.json` | `fixtures:update` script |
| `packages/protocol/AGENTS.md` | fixture contract section, layout |

## Build & test results
```
$ npx vitest run packages/protocol/src/external-fixtures.test.ts   # 62 passed, ~250 ms
$ npm run build:protocol                                           # success
$ npx oxfmt <changed>; npx oxlint packages/protocol                # clean
```
Mutation proofs (each run once on the real files, then reverted):
- renamed leaf in `ping.json` (no bump) → guard test fails ("breaking fixture change without a formatVersion bump");
- same + `formatVersion` 2 + CHANGELOG line naming `ping.json` → guard test passes (only the unrelated stale-volatile-pointer check fails, as expected for a rename); `npm run fixtures:update` without the bump prints "Refusing to update";
- added optional `extra` field → all pass;
- unlisted `zz_unlisted.json` → "lists exactly the fixture files on disk" fails;
- `"password":"hunter2"` → secret scan fails.

## Acceptance criteria
- [x] All current fixtures pass
- [x] Mutation proofs recorded (above)
- [x] Runtime < 1 s

## Follow-ups / TODO(verify)
- Additive edits do not auto-refresh `.signatures.json`; run `fixtures:update` after adding fields or later removal of that field would not be flagged (spec-accepted).
