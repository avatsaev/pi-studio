# Task 005 — Status-bar value formatters — Summary

- **Sprint:** sprint-042-workspace-status-bar
- **Completed:** 2026-07-24
- **Status:** done

## What was implemented
`packages/web-client/src/features/workspace/status-bar-format.ts` — five pure, DOM-free functions:
`formatTokens` (exact <1000, `"12.3k"`/`"1.2M"` above, one decimal always), `formatPercent`
(normalizes a 0–1 fraction or a 0–100 whole number to a rounded integer `%`, `--` for null/
undefined), `formatCost` (4 decimals under $1, 2 decimals at/above $1, `--` for undefined),
`formatCwd` (collapses an exact or prefixed `home` match to `~`/`~/...`, exact-segment boundary so
`/home/devops` never false-matches a `/home/dev` home), and `formatBranchMeta` (`"↑2 ↓1"`, omitting
a zero side, empty string when both are zero).

## Files created / changed
| File | Change |
|------|--------|
| `packages/web-client/src/features/workspace/status-bar-format.ts` | created |
| `packages/web-client/src/features/workspace/status-bar-format.test.ts` | created — 19 tests |

## How it satisfies the scope
- `clean-room-scope/features/workspace-ui.md` § Header / status metadata: these are the exact
  display transforms task-006's `StatusBar` component needs for its token/context/cost/cwd/branch
  segments; kept as pure functions per the project's `lib/`-style convention (framework-free, fully
  unit-tested core logic feeding a thin presentational component).

## Build & test results
```
$ npm run typecheck
> tsc -b
(success, no output)

$ npx vitest run packages/web-client/src/features/workspace/status-bar-format.test.ts
✓ packages/web-client/src/features/workspace/status-bar-format.test.ts (19 tests) 3ms
Test Files  1 passed (1)
     Tests  19 passed (19)
```

## Acceptance criteria
- [x] Each helper handles the empty/`undefined` case with a stable placeholder (`"--"` or `""`) —
  verified by a dedicated test per function.
- [x] `formatTokens`/`formatCost` thresholds and rounding are exactly as specified and covered —
  boundary tests at 999/1000/1_000_000 for tokens, and at exactly $1 for the cost precision switch.
- [x] `formatPercent` normalizes both fraction and whole-number inputs — covered (0.25→25%,
  1→100%, 42→42%, 42.6→43%).
- [x] `formatCwd` collapses home to `~` and is a no-op when `home` is null or not a prefix —
  covered, plus an extra sibling-prefix false-positive guard test
  (`/home/devops` vs `home:"/home/dev"`) not explicitly required by the task but caught during
  implementation as an easy-to-get-wrong edge case worth locking down.
- [x] `npm run typecheck` passes.

## Follow-ups / TODO(verify)
- None. This task's scope matched a straightforward, dependency-free implementation with no
  deviation from the plan.
