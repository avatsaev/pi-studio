# Task 005 — Status-bar value formatters

- **Sprint:** sprint-042-workspace-status-bar
- **Status:** done
- **Estimated size:** XS
- **Depends on:** none

## Goal
Add small, pure, unit-tested formatting helpers for the status-bar segments: token counts
(`16.4k` / `1.2M`), context percent (integer `%`), cost (adaptive `$` precision), and a
home-collapsed / ellipsized cwd label.

## Background / why
The bar renders numbers that must stay compact inside a fixed 75px-tall row. Keeping formatting in
a pure module (no React, no DOM) makes it trivially testable and reusable, matching the project
convention that core logic lives in unit-tested `lib/` free of DOM deps.

## Scope references
- `clean-room-scope/features/workspace-ui.md` § Header / status metadata
- `packages/web-client/AGENTS.md` § lib layout (framework-free logic)

## What to build
- **`packages/web-client/src/features/workspace/status-bar-format.ts`** (or `lib/`), pure functions:
  - `formatTokens(n?: number): string` — `undefined` → `"--"`; `<1000` → exact; `≥1000` → `"12.3k"`;
    `≥1_000_000` → `"1.2M"` (one decimal, trimmed).
  - `formatPercent(p?: number): string` — accepts a 0–1 fraction OR a 0–100 number (normalize),
    `undefined` → `"--"`, else rounded integer + `"%"`.
  - `formatCost(c?: number): string` — `undefined` → `"--"`; small values keep more precision
    (e.g. `$0.0042`), larger values 2 dp (`$12.34`). Define the threshold explicitly.
  - `formatCwd(cwd: string, home?: string | null): string` — collapse a leading `home` to `~`;
    return the collapsed path (the component applies CSS ellipsis + a `title` with the full path).
  - `formatBranchMeta(ahead: number, behind: number): string` — `""` when both zero, else
    `"↑2 ↓1"` (omit a zero side).

## Out of scope
- The component that calls these (task-006).
- Any store/network access — these are pure.

## Acceptance criteria
- [ ] Each helper handles the empty/`undefined` case with a stable placeholder (`"--"` or `""`).
- [ ] `formatTokens`/`formatCost` thresholds and rounding are exactly as specified and covered.
- [ ] `formatPercent` normalizes both fraction and whole-number inputs.
- [ ] `formatCwd` collapses home to `~` and is a no-op when `home` is null or not a prefix.
- [ ] `npm run typecheck` passes.

## Test / verification plan
- `status-bar-format.test.ts`: table-driven cases for each helper including boundaries (999→exact,
  1000→`1.0k`, 1_000_000→`1.0M`), fraction vs whole percent, tiny vs large cost, home-prefix vs not.
- `npx vitest run packages/web-client/src/features/workspace/status-bar-format.test.ts`.

## Notes
- Keep glyphs (`↑ ↓ ● ⚠`) out of the number formatters where a segment owns its own icon; only
  `formatBranchMeta` embeds arrows since they encode the two-value ahead/behind relationship.
