# Task 005 — Parity gate: the move changed nothing — Summary

- **Sprint:** sprints/sprint-092-workbench-move
- **Completed:** 2026-11-14
- **Status:** done

## What was implemented
Ran the full gates from a clean tree and compared against the sprint-091 baseline; ran the browser checklist against the production daemon. Results appended to `swe/notes/workbench-baseline.md` § After the move.

## Files created / changed
| File | Change |
|------|--------|
| `swe/notes/workbench-baseline.md` | "After the move" section |

## How it satisfies the scope
`workbench-package.md` § Acceptance criteria (browser client unchanged, tests not dropped, size and chunks matched).

## Build & test results
```
$ npm run clean && npm run build && npm run typecheck && npm run lint   -> exit 0
$ npm test                                -> 259 files / 3534 tests passed (baseline 260/3535 incl. the deleted sprint-091 placeholder test)
$ npx vitest run packages/workbench packages/web-client -> 109 / 1453 (= baseline)
$ du -sb packages/web-client/dist/web     -> 26530220 (= baseline)
$ diff <baseline chunk list> <current>    -> identical
$ dynamic import() sites                  -> 16 (= baseline)

Browser (production daemon 127.0.0.1:6767, scratch workspace /tmp/wb-parity): connect, chat turn (assistant "ok"),
drag-to-split, terminal typing ("parity-42"), text/PNG/PDF viewers, explorer upload (bytes verified on disk),
reload restores both panes; zero page/console errors.
```

## Acceptance criteria
- [x] Every gate passes from a clean build.
- [x] Test count at baseline (the only removed test is the sprint-091 placeholder).
- [x] `dist/web` 0% delta; chunk list identical.
- [x] Browser check passes with no console errors.
- [x] The note records all of the above.
- [x] `docs/desktop-client-handoff.md`: progress row for 092 updated at sprint close.

## Follow-ups / TODO(verify)
- Reported, not caused by the move: after reload the restored left-pane tab order differs and the terminal tab shows the daemon's name (`terminal-3`). Pre-existing restore behaviour; not investigated further.
- The scratch workspace `/tmp/wb-parity` (and its one chat) is still registered on the production daemon: deleting it goes through `window.confirm`, which the headless browser did not surface. Remove it during sprint 093's dialog work (task-002) or by hand.
