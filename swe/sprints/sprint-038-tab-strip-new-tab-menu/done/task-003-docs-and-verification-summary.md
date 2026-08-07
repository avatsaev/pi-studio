# Task 003 — Docs sync + full verification pass — Summary

- **Sprint:** sprint-038-tab-strip-new-tab-menu
- **Completed:** 2026-07-23
- **Status:** done

## What was implemented
Updated `packages/web-client/AGENTS.md`:
- `features/workspace/` source-layout row now notes `TabStrip` hosts the trailing "+" menu (New
  chat / New terminal, scoped to the active workspace — GitHub issue #8). No file split was needed
  — `NewTabMenu` stayed as a ~25-line sub-component inside `TabStrip.tsx` (task-002 estimated
  splitting it out only if it grew past ~40 lines; it didn't), so no new source file to list.
- The file-upload/download invariant note now also documents that the dev daemon
  (`dev-bootstrap.ts`) registers no terminal-RPC handler either (`create_terminal_request` has no
  handler), and that smoke-testing terminals — via `Ctrl/Cmd+T` **or** the new TabStrip "+" menu —
  needs `npm start`/`npm run start:server`, not `npm run dev:daemon`. This generalizes the existing
  "Files sidebar transfer actions" caveat discovered while smoke-testing task-002, so the next
  contributor isn't surprised by the same dev-daemon gap.

Then ran the full verification suite for the sprint.

## Files created / changed
| File | Change |
|------|--------|
| `packages/web-client/AGENTS.md` | source-layout row for `features/workspace/`; expanded dev-daemon RPC-gap invariant note to cover terminals |

## How it satisfies the scope
Matches the task's "What to build": docs-only change, no source edits. Satisfies root
`AGENTS.md`'s "Docs sync on code changes" rule for the sprint as a whole (task-001/002 already
kept doc updates in-scope per their own summaries' file lists — this task is the sprint's explicit,
checkable closure step per the task file's own rationale).

## Build & test results
```
$ npm run typecheck -w @av-pi-studio/web-client
> tsc -p tsconfig.json --noEmit
(no output — success)

$ npm run lint
exit=0
(all warnings pre-existing and unrelated to sprint-038's touched files — confirmed none of
TabStrip.tsx / tab-store.ts / SessionList.tsx / open-workspace.ts / use-session-restore.ts appear
in the warning list)

$ npm test
 Test Files  85 passed (85)
      Tests  666 passed (666)
```

Re-ran the task-002 manual browser check once more (dev daemon + dev server, driven via the
`browser` device) as the sprint's final smoke test: `+` → "New chat" and `+` → "New terminal" both
still worked exactly as documented in task-002's summary (terminal creation still surfaces the
pre-existing, now-documented dev-daemon gap; chat creation fully succeeds).

## Acceptance criteria
- [x] `packages/web-client/AGENTS.md` source layout accurately reflects the files task-001/002
      added or changed.
- [x] `npm run typecheck -w @av-pi-studio/web-client` passes.
- [x] `npm run lint` passes (only pre-existing, unrelated warnings remain).
- [x] `npm test` (vitest, workspace-wide) passes — 85/85 files, 666/666 tests.

## Follow-ups / TODO(verify)
- None new. The dev-daemon terminal-RPC gap is now documented in `AGENTS.md` rather than left
  implicit; fixing it (wiring a terminal handler into `dev-bootstrap.ts`) is out of scope for this
  sprint — it predates issue #8 and affects `Ctrl/Cmd+T` identically, not just the new "+" menu.
