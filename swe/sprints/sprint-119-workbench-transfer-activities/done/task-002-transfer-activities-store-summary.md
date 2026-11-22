The two failing tests in `packages/workbench/src/host/files.test.ts` now pass through the activity store, and the whole package is green: `npx vitest run packages/workbench` ran 137 files and 1785 tests with none failing. The `Command exited with code 1` at the end came from my last `grep` for lint findings in `files.test.ts` finding none, so lint is clean there.

Only that file changed, and I kept both tests:
- **Rejected upload:** it now checks that the activity line read `Uploading 1 file…`, that no activity is left, and that `lastResult` is `{ text: "Upload failed: disk full", error: true }`. The test is renamed "reports a rejected upload as the last result".
- **Percentage:** it now records the first activity's line text through a new `recordLines()` helper that subscribes to the store. The same assertions run on those lines: the percentages never go backwards, no percent repeats, 25 appears, and the last one is 100. The final `lastResult` is `Uploaded 2 files`. The test is renamed to say "activity" instead of "status line".
- **Declined overwrite:** I also dropped the `setStatus` argument from the "uploads nothing when an overwrite is declined" test, which would no longer compile.

The `beforeEach` in the file now also resets the activity store. I ran oxfmt on the file, and the removed `UploadStatus` import is gone.

## Wave gate (orchestrator, combined tree)
```
npm run build -> ok; npm run typecheck -> ok; npm run lint -> 0 errors; npm test -> 295 files, 4204 tests passed
(first run: 2 failures in packages/workbench/src/host/files.test.ts, caused by sprint-119/task-002 removing the setStatus dep; the tests were moved onto the activity store and the gate re-run)
cargo xtask ci (desktop/) -> all 8 steps passed, including shell's process tests
```
