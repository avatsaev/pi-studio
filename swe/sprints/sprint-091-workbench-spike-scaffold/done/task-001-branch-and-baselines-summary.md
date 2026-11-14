# Task 001 — Feature branch + pre-move baselines — Summary

- **Sprint:** sprints/sprint-091-workbench-spike-scaffold
- **Completed:** 2026-11-14
- **Status:** done

## What was implemented
Branch `feat/workbench` cut from `main` at `e705d84` (release 0.0.117, verified equal to `origin/main` after fetch); the scope/plan documents were committed on it as `0f2f2ce`. Wrote `swe/notes/workbench-baseline.md` with the parity reference: dist size, chunk list, test counts, source file count, `@web-client/` import counts and the dynamic-import sites, each with its command.

## Files created / changed
| File | Change |
|------|--------|
| `swe/notes/workbench-baseline.md` | created |

## How it satisfies the scope
Provides the numbers `workbench-package.md` § Acceptance criteria checks the move against (size within ±2%, identical chunk names, same test count, same lazy-import sites). Planning-time figures confirmed: 227 source files, 109 test files, 452 imports in 151 files.

## Build & test results
```
$ git fetch origin && git rev-parse origin/main HEAD~1
e705d844… e705d844…  (branch based on current main)

$ npm run build:web-client && du -sb packages/web-client/dist/web | cut -f1   (run twice)
26530220
26530220

$ npx vitest run packages/web-client
Test Files 109 passed (109) / Tests 1453 passed (1453)
```

## Acceptance criteria
- [x] `swe/notes/workbench-baseline.md` exists with every value and a command for each.
- [x] Work happens on `feat/workbench`.
- [x] Two consecutive builds give the same total size (26530220 bytes).
- [x] `docs/desktop-client-handoff.md`: nothing in it was affected (no source change; it already names `feat/workbench` and sprint 091 as not started — the progress table is updated at sprint end).

## Follow-ups / TODO(verify)
- Emitted-file count is 657 (ui-library baseline listed 457 at an earlier commit); this note is the reference from now on.
