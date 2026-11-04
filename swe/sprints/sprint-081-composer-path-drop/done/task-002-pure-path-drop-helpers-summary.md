# Task 002 — Pure helpers: `relativeRefPath`, `formatRefToken`, `planInsertion` — Summary

- **Sprint:** sprints/sprint-081-composer-path-drop
- **Completed:** 2026-11-03
- **Status:** done

## What was implemented
`packages/web-client/src/features/chat/composer-path-drop.ts`: `refRoot`, `relativeRefPath` (strict
segment-boundary containment, trailing `/` preserved), `formatRefToken` (CommonMark code-span quoting for
whitespace/backtick), `planInsertion` (D13 smart spacing, clamped/ordered offsets, returns
`{start,end,insert,caret}`) and the `InsertionPlan` type. `relativeToRoot` deliberately not reused.

## Files created / changed
| File | Change |
|------|--------|
| `packages/web-client/src/features/chat/composer-path-drop.ts` | created |
| `packages/web-client/src/features/chat/composer-path-drop.test.ts` | created (22 tests) |

## How it satisfies the scope
Follows spec § Public contract 5 and § Behavior & algorithms pseudocode. `planInsertion` also treats a
non-finite offset as 0 (extra robustness beyond the spec's clamp).

## Build & test results
```
$ npx vitest run packages/web-client/src/features/chat/composer-path-drop.test.ts
22 passed, 0 failed
$ npx oxfmt <changed files>            # clean
$ npm run build:web-client             # success (only the pre-existing chunk-size notice)
$ npm run typecheck                    # success
$ npm run lint                         # 0 errors; warnings are pre-existing, none in changed files
```

## Acceptance criteria
- [x] `refRoot` cases (tilde w/o home, `~/p`, trailing slash, empty cwd)
- [x] `relativeRefPath` cases (inside, folder `/`, sibling prefix, root itself, null/empty/`~` root)
- [x] `formatRefToken` cases (bare, space, tab/newline, inner backtick, leading/trailing backtick)
- [x] `planInsertion` cases (empty, glued word, before whitespace, line start, selection, clamping)

## Follow-ups / TODO(verify)
- `lib/paths.ts` `relativeToRoot` + tree *Copy Relative Path* fix remain spec TODO #4 (out of scope).
