# Task 003 — Shared validation conventions + base types — Summary

- **Sprint:** sprint-001-foundation
- **Completed:** 2026-06-11
- **Status:** done

## What was implemented
Added the project-wide Zod validation conventions and shared base primitives to
`@av-pi-studio/protocol` (`src/validation.ts`), re-exported from the package index. The module
encodes the append-only compatibility rules and the `COMPAT(name)` shim convention as guidance
(doc comment) plus grep-able/lint-checkable helpers, and provides the shared primitive schemas and
the `safeParseOrDefault` fallback used by the persistence stores. A companion reference doc lives at
`docs/validation-conventions.md`.

## Files created / changed
| File | Change |
|------|--------|
| `packages/protocol/src/validation.ts` | created — helpers + primitives + conventions doc-comment |
| `packages/protocol/src/index.ts` | modified — re-exports validation module |
| `packages/protocol/src/validation.test.ts` | added — 11 tests |
| `docs/validation-conventions.md` | created — convention reference |

### Exports
- `COMPAT(tag)` + `CompatTag` — grep-able back-compat shim marker (name + addedIn + removeBy).
- `optionalWithDefault(schema, default)` — sanctioned append-only optional-with-default field.
- `safeParseOrDefault(schema, value, defaults)` — parse-or-fallback for stores.
- `isoTimestampSchema`, `uuidSchema`, `base64UrlSchema`/`isBase64Url`, `prefixedIdSchema(prefix)`.

## How it satisfies the scope
- **MAIN-SCOPE §9 (Cross-Cutting Conventions):** append-only rules (optional+default, never flip
  optional→required, never remove/narrow) and the `COMPAT(name)` tag (version + removal date) are
  documented in both the module doc-comment and `docs/validation-conventions.md`.
- **architecture/persistence.md (Behavior — "Corrupt/partial JSON → fall back to defaults"):**
  `safeParseOrDefault` returns defaults on any parse failure, so stores never crash the daemon on
  bad input.
- **architecture/websocket-protocol.md (Compatibility rules):** `optionalWithDefault` is the
  helper for adding fields without breaking old producers; new enum values remain gated by
  capability flags (enforced where schemas are defined in sprint-002).

## Build & test results
```
$ npm run build:protocol
exit 0 — no type errors; validation.{js,d.ts} emitted to dist/

$ npx vitest run packages/protocol/src/validation.test.ts
 ✓ packages/protocol/src/validation.test.ts (11 tests) 4ms
 Test Files  1 passed (1)
      Tests  11 passed (11)

$ npm run build          → exit 0 (full layered build)
$ npx vitest run         → 2 files, 12 tests passed
$ npx oxlint             → exit 0
$ npx oxfmt --check .    → clean
```

## Acceptance criteria
- [x] A documented convention file/module exists describing append-only rules and `COMPAT(name)`
      (`validation.ts` doc-comment + `docs/validation-conventions.md`).
- [x] `safeParseOrDefault` returns defaults on invalid input and the parsed value on valid input
      (verified by tests for valid object, invalid object, `null`, `undefined`).
- [x] Shared primitive schemas validate/reject representative inputs (timestamp UTC/offset vs.
      garbage/date-only/number; UUID valid vs. malformed; base64url charset vs. padding/space/+//;
      `prefixedIdSchema` accepts `srv_…` and rejects wrong prefix / empty body).

## Follow-ups / TODO(verify)
- Actual message/store schemas (which consume these helpers) are built in sprint-002 (protocol) and
  sprint-003 (persistence/config).
