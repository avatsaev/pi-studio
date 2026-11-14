# Task 007 — Host guard test, recording test host, and host acceptance — Summary

- **Sprint:** sprints/sprint-093-workbench-host
- **Completed:** 2026-11-14
- **Status:** done

## What was implemented
Added `src/host/host-guard.test.ts`: scans every non-test workbench source except `host/browser-*.ts` and `src/test/` (comments stripped first, keeping `https://`) for `localStorage`, `sessionStorage`, `navigator.clipboard`, `window.confirm/alert/prompt/location/history/open`, `import.meta.env`, `?worker`, `new WebSocket(`; reports `file: token (use host.<member>)`; asserts it scanned more than 200 files. `createTestHost()` (built up across tasks 002–006 in `src/test/test-host.ts`) is now used by all six host test files — `host.test.ts` switched from its private memory host. Added a test that boots from the test host's initial connect intent. Ran every acceptance criterion of `workbench-host-adapter.md` and ticked 7 of 8; the README criterion is left open with its reason (written in sprint 094 task-004). The spec's two in-scope TODO(verify) entries (StrictMode installation, drop sources) were resolved in tasks 001/005; the two Tauri ones stay (out of scope here).

## Files created / changed
| File | Change |
|------|--------|
| `packages/workbench/src/host/host-guard.test.ts` | created |
| `packages/workbench/src/host/host.test.ts` | uses createTestHost |
| `packages/workbench/src/host/launch.test.ts` | boot-from-intent test |
| `swe/architecture/workbench-host-adapter.md` | acceptance ticked / reasoned |

## How it satisfies the scope
`workbench-host-adapter.md` § Acceptance criteria and § TODO(verify).

## Build & test results
```
$ npx vitest run packages/workbench/src/host/host-guard.test.ts -> 2 passed
  planted `localStorage.getItem("x")` in features/files/SaveFileButton.tsx -> 1 failed:
  + "features/files/SaveFileButton.tsx: localStorage (use host.storage)"; reverted -> 2 passed
$ npx vitest run packages/workbench/src/host -> 8 files / 44 tests passed
Browser: temporary `host.files.pickUploads` in web-client's main.tsx -> Upload made 0 file-input clicks, "Uploaded 1 file", /tmp/wb-files/host-pick.txt written; temporary code removed.

$ npm run build && npm run typecheck && npm run lint && npm test
BUILD-OK / TC-OK / lint=0 / Test Files 266 passed (266), Tests 3571 passed (3571)
```

## Acceptance criteria
- [x] The guard passes and fails when a forbidden token is added to a feature file (shown, reverted).
- [x] `createTestHost()` exists and is used by the host tests of tasks 001–006.
- [x] Every host-spec acceptance criterion is ticked or has a written reason (README → sprint 094 task-004).
- [x] `npm run build && npm run typecheck && npm run lint && npm test` pass.
- [x] `docs/desktop-client-handoff.md`: updated at sprint close (progress row; host section states the seam is complete and guarded).

## Follow-ups / TODO(verify)
- None.
