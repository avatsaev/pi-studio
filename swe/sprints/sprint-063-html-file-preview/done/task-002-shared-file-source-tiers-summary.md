# Task 002 — Shared file-source size ladder (`use-file-source`) — Summary

- **Sprint:** sprint-063-html-file-preview
- **Completed:** 2026-08-19T11:12Z
- **Status:** done

## What was implemented

Extracted `TextViewer`'s three-tier source-loading ladder into a new reusable hook,
`packages/web-client/src/hooks/use-file-source.ts`. The hook composes `useFileRead` (tier 1),
`useFileText` (tier 2), and `useFileDownload` (tier 3) around the existing pure, DOM-free
`selectTextViewerState` selector (`text-viewer-state.ts`, unmoved and unmodified — it remains the
single decision core) and adds one thing the pure selector cannot own itself: a bound
`requestDownload()` callback on the terminal `too-large` state, closing over the hook's own
`downloadRequested` `useState`.

`FileSourceState` is `TextViewerState` verbatim, plus that bound callback on the `too-large`
variant (`Exclude<TextViewerState, {kind:"too-large"}> | (Extract<...> & {requestDownload(): void})`)
— deliberately **not** collapsed into a coarser `loading/ready/error/too-large` shape, because doing
so would erase the distinct `streaming` (tier-2 fetch in flight, with its own spinner + "Streaming
X MB file..." copy) and `stream-error` states, which is an observable regression `TextViewer` is
required not to have.

`TextViewer.tsx` is re-expressed as a thin switch over the hook's result with **zero** changes to
rendered markup, copy, or `MAX_DISPLAY_BYTES` semantics (30 MiB, now exported from the hook module
instead of the component). `MarkdownFileViewer.tsx` is switched from a bare `useFileRead` onto the
same hook, gaining the tier-2 streamed path (files 5–30 MiB now preview instead of showing the raw
string `file_too_large`) and the tier-3 terminal download state — both rendered with the same
muted-note/download-button treatment `TextViewer` uses, added to `MarkdownFileViewer.module.css`
(`.streamedNote`, `.tooLarge`, copied token-for-token from `TextViewer.module.css`).

**Note on process:** the first implementation attempt (a background subagent) crashed mid-task on a
malformed tool call, leaving `use-file-source.ts` with duplicated/invalid union members and
`TextViewer.tsx` referencing a nonexistent export. That draft was discarded and this hook and both
consumers were rewritten from scratch against the task's actual contract, then verified end-to-end
(build, typecheck, scoped tests, `oxfmt`) against the final combined state of this task and
task-001 together.

## Files created / changed

| File | Change |
|------|--------|
| `packages/web-client/src/hooks/use-file-source.ts` | Created — `useFileSource` hook + `FileSourceState`/`MAX_DISPLAY_BYTES` |
| `packages/web-client/src/features/files/TextViewer.tsx` | Re-expressed on `useFileSource`; identical rendered states/copy |
| `packages/web-client/src/features/files/MarkdownFileViewer.tsx` | Switched from `useFileRead` to `useFileSource`; added streaming/too-large states |
| `packages/web-client/src/features/files/MarkdownFileViewer.module.css` | Added `.streamedNote`, `.tooLarge` (copied from `TextViewer.module.css`) |

`text-viewer-state.ts` / `text-viewer-state.test.ts` are unchanged — the pure selector stayed where
it was, since it is already DOM-free and already unit-tested independently of `TextViewer`; nothing
in the task required relocating it.

## How it satisfies the scope

- `use-file-source.ts` is the only place the tier decision is made; `selectTextViewerState` is
  called exactly once, inside the hook. `TextViewer` contains no branching beyond a `switch` on the
  returned discriminant.
- The pure tier selector's own test suite (`text-viewer-state.test.ts`, 10 tests covering all three
  tiers plus boundary conditions) is untouched and still passes.
- `TextViewer`'s five rendered states (loading, inline, streaming, streamed, too-large) and their
  exact copy/markup are byte-for-byte what they were before the extraction — verified by diffing
  the pre-task component against the post-task one status-by-status.
- A markdown file over the inline cap now resolves to `streamed` (5–30 MiB) or `too-large`
  (> 30 MiB) instead of the pre-task bare-`useFileRead` behavior, which surfaced the literal string
  `file_too_large` as an unhandled error message.

## Build & test results

```
$ npm run clean && npm run typecheck
> tsc -b
(no errors)

$ npm run build:web-client
> tsc -b && vite build
✓ built in 10.23s

$ npx vitest run packages/web-client/src/features/files packages/web-client/src/hooks packages/web-client/src/timeline
 Test Files  28 passed (28)
      Tests  349 passed (349)

$ npx oxfmt --check packages/web-client/src/hooks/use-file-source.ts packages/web-client/src/features/files/TextViewer.tsx packages/web-client/src/features/files/MarkdownFileViewer.tsx packages/web-client/src/features/files/MarkdownFileViewer.module.css
All matched files use the correct format.

$ npx oxlint packages/web-client/src/hooks/use-file-source.ts packages/web-client/src/features/files/TextViewer.tsx packages/web-client/src/features/files/MarkdownFileViewer.tsx
(no errors, exit 0)
```

These commands were run against the final combined tree (this task + task-001), which is the state
that actually ships — running them in isolation against either task's changes alone would not have
caught the one integration defect below.

## Acceptance criteria

- [x] `use-file-source.ts` exists and is the only place the tier decision is made; `TextViewer`
      contains no tier branching of its own — verified by inspection (a single `switch` over the
      hook's return value, no `useFileRead`/`useFileText`/`useFileDownload` calls left in the
      component).
- [x] The pure tier selector keeps unit tests covering all three tiers (moved, not deleted) and
      they pass unchanged — `text-viewer-state.test.ts` untouched, 10/10 passing.
- [x] `TextViewer`'s observable states are unchanged: normal file, over-inline-cap streamed file
      (with the streamed note), over-display-cap terminal state with a working download action —
      verified by direct comparison against the pre-task component; all five states (including the
      transient `streaming` spinner) are preserved.
- [x] A markdown file larger than 5 MiB previews via the streamed tier instead of showing
      `file_too_large` — verified by inspection: `MarkdownFileViewer` now runs the identical ladder
      `TextViewer` does, with a `streaming`/`streamed`/`too-large` render path.
- [x] `npm run build:web-client` and `npm run typecheck` pass — see above.

## Follow-ups / TODO(verify)

- Manual verification (per the task's test plan) requires the production daemon (`npm start` — the
  binary download path used by tier 2/3 is registered only in the production bootstrap, not
  `dev:daemon`) with real files over 5 MiB and 30 MiB; not performed in this automated pass. Task-004
  (docs + pre-ship verification) covers a browser pass for the sprint as a whole.
- The first (discarded) implementation attempt's partial edits are not present in the final diff;
  no cleanup needed beyond what's described above.
