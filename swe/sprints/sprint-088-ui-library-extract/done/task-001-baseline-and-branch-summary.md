# Summary — sprint-088 task-001 baseline-and-branch

## What was built
Recorded the pre-move web-client build baseline in `swe/notes/ui-library-baseline.md` (total bytes,
457 hash-stripped asset names, per-CSS sizes, SHA, reproducible command).

## Files changed
- `swe/notes/ui-library-baseline.md` (new)

## Commands run
- `npm run build:web-client` ×2 → exit 0; `du -sb packages/web-client/dist/web` = 26532061 both times; hash-stripped name lists identical.

## Acceptance criteria
- [x] Baseline note exists with size, chunk list, CSS sizes, SHA, command.
- [x] Work is on a feature branch, not `main`: the already-existing `feat/ui-lib` was used instead of creating `feat/ui-library`.

## Follow-ups
- The scaffold's untracked `packages/ui-library` + root config edits were present in the tree while measuring; they do not feed web-client's build.
