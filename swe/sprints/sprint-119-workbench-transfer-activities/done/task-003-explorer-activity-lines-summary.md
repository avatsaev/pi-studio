# Task 003 — Explorer activity lines — Summary

- **Sprint:** sprints/sprint-119-workbench-transfer-activities
- **Status:** done

## What was implemented
- **Activity lines:** the Files explorer now draws one line per running activity under the header. They are oldest first, at most four, then `and N more`. Each line has an ellipsized text and a Cancel button named `Cancel: <label>`. The name uses the label, not the moving text, so it stays stable while the percentage changes. Each line is a `React.memo` component, so its DOM changes only when its text does.
- **Pure functions:** `MAX_ACTIVITY_LINES`, `visibleActivities`, `hiddenActivitiesText` and `cancelActivityName` sit in `stores/transfer-activity-text.ts`, next to task-002's `activityText`.
- **Transient status:** the explorer's one status line now also shows the store's `lastResult`. An effect copies it into the status state, then calls `clearResult(seq)`. Move, create and rename statuses work as before. A result recorded while the explorer was unmounted shows on mount.
- **Cancel is silent:** `FileContextMenu` no longer alerts for an `AbortError`. `SaveFileButton` sets no error for one. `PdfViewer` shows no alert for one. Other feedback is unchanged.
- **Styles:** `ActivityLines.module.css` uses tokens only, `rem`-free (no literal sizes), no fallback values, and ellipsis on long text. The Cancel button resets background, border and cursor.

## Files created / changed
| File | Change |
|------|--------|
| `packages/workbench/src/features/files/ActivityLines.tsx` | created: `ActivityLines` (store-bound) and `ActivityLinesView` (pure view), memoised `ActivityLine` |
| `packages/workbench/src/features/files/ActivityLines.module.css` | created |
| `packages/workbench/src/features/files/ActivityLines.test.ts` | created: render tests |
| `packages/workbench/src/features/files/FileExplorer.tsx` | modified: draws `<ActivityLines />`, feeds `lastResult` into the status |
| `packages/workbench/src/features/files/FileContextMenu.tsx` | modified: silent on `AbortError` |
| `packages/workbench/src/features/files/SaveFileButton.tsx` | modified: no error on `AbortError` |
| `packages/workbench/src/features/files/PdfViewer.tsx` | modified: no alert on `AbortError` |
| `packages/workbench/src/stores/transfer-activity-text.ts` | modified: cap and text functions |
| `packages/workbench/src/stores/transfer-activity-store.test.ts` | modified: tests for the new pure functions |
| `packages/workbench/AGENTS.md` | modified: stores and files entries |

I added `ActivityLinesView`, a version of the component that takes `activities` as a prop. Zustand's server snapshot ignores `setState`, so `renderToStaticMarkup` on the store-bound component always renders empty.

## Build & test results
```
$ npx vitest run packages/workbench
Test Files  138 passed (138)   Tests  1792 passed (1792)

$ npx tsc -b --force
(no output, success)

$ npm run lint
no finding in any changed file (the warnings it prints are in other files)

$ npx oxfmt <changed .ts/.tsx/.css files>
done

$ (cd desktop/apps/pistudiodesktop && npm run check)
tsc -b, success
```
I did not run `npm run build` or `npm run snapshot`, as instructed.

## Acceptance criteria
- [x] Two saves and a batch give three lines, each with its own Cancel. "A line's DOM changes only when its text does" rests on `React.memo` keyed by the activity id. There is no jsdom to test it, so that part is unverified by a test. The line count, texts and Cancel names are covered by `ActivityLines.test.ts`.
- [x] Six activities give four lines and `and 2 more` (`ActivityLines.test.ts`, `visibleActivities` tests).
- [x] A save cancelled from its line shows no alert in the row menu, no error in the viewer button and no alert in the PDF toolbar. All three branch on `isAbortError`, which is tested in the store tests. The UI paths themselves are not tested, since there is no DOM test setup.
- [x] The style tests pass: `design-tokens.test.ts` ran inside the full workbench run.

## Follow-ups / TODO(verify)
- The rendering, the Cancel click and the silent cancel in the three triggers need a look in a real client (task-004, and the orchestrator's snapshot).
- `vitest.config.ts` only includes `*.test.ts`, so a `.test.tsx` file would be silently skipped. That is why the render test is a `.ts` file using `createElement`.

## Wave gate (orchestrator, combined tree)
```
npm run build -> ok; npm run typecheck -> ok; npm run lint -> 0 errors; npm test -> 296 files, 4211 tests passed
desktop frontend: npm run snapshot -> wrote snapshot.png, no CSP violation
```
