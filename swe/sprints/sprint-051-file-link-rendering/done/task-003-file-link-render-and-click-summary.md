# Task 003 — `FileLink` component, `a` markdown override, converged click-to-open — Summary

- **Sprint:** sprint-051-file-link-rendering
- **Completed:** 2026-08-05
- **Status:** done

## What was implemented
A new `FileLink` component renders `classifyFileLinkSrc`'s `local` results as actionable,
pane-targeted click-to-open anchors via a new `a` markdown node override, registered alongside the
existing `img`/`code` overrides. `InlineImage`'s hand-rolled `useTabStore.getState().open(...)` click
handler is converged onto the same `openFileTab` dispatch the Files tree already uses, so the
pane-targeting fix lands once for both features. A small shared pure function,
`resolveFileOpenTarget(assetBase, owningPaneId, workspaceCwd)`, computes the `openFileTab`
arguments (`workspaceCwd` fallback, `owningPaneId` → `targetPaneId` conversion) identically for both
call sites — the "puts the fix in exactly one place" requirement, made a real testable seam rather
than duplicated inline logic.

## Files created / changed
| File | Change |
|------|--------|
| `packages/web-client/src/timeline/FileLink.tsx` | new — classify + render actionable/external anchor |
| `packages/web-client/src/timeline/file-open-target.ts` | new — shared `resolveFileOpenTarget` pure function |
| `packages/web-client/src/timeline/file-open-target.test.ts` | new — 4 unit tests |
| `packages/web-client/src/timeline/markdown.tsx` | registers `a: (props) => <FileLink .../>` alongside `img`/`code` |
| `packages/web-client/src/timeline/InlineImage.tsx` | click handler converged onto `openFileTab` + `resolveFileOpenTarget`; dropped unused `useTabStore`/`tabIds` imports |
| `packages/web-client/src/timeline/markdown.test.ts` | extended with a "converged click-to-open dispatch (task-003)" describe block covering `FileLink` classification→dispatch and the `InlineImage` regression case |

## How it satisfies the scope
Matches `file-link-rendering.md` § Render pipeline exactly: `classifyFileLinkSrc` → `external` renders
an unmodified `<a>`; `local(path)` renders an actionable anchor whose `onClick` prevents navigation
and dispatches `openFileTab(path, workspaceCwd ?? (assetBase || "~"), owningPaneId ?? undefined)`.
`InlineImage`'s pre-existing click-to-open now goes through the identical dispatch, so the pane
targeting/workspace-cwd fix applies to both features from one code path
(`inline-image-rendering.md` § Click-to-open, amended).

## Build & test results
```
$ npm run typecheck
tsc -b — success, zero errors

$ npm run build:web-client
vite build — success (dist/web emitted)

$ npm run lint
oxlint — 0 new warnings/errors on any touched file

$ npx vitest run packages/web-client/src/timeline
Test Files  7 passed (7)
     Tests  131 passed (131)
```

### Manual E2E (dev daemon `npm run dev:daemon` + web-client dev server, mock provider)
Opened the repo as a workspace, started a new chat, and sent a message containing:
`[relpath](README.md) [abspath](/home/avatsaev/DEV/avatsaev/pi-studio/package.json)
[tildepath](~/DEV/avatsaev/pi-studio/AGENTS.md) [ext](https://example.com) [anchor](#section)`.
The mock provider echoes the prompt verbatim, rendering all five links through the real pipeline.
Verified in the live DOM:
- `relpath`, `abspath`, `tildepath` render with an attached `onClick` handler (`ext`/`anchor` do
  not) — matching the local/external split exactly.
- Clicking `relpath` opened a new tab titled `README.md` at
  `/home/avatsaev/DEV/avatsaev/pi-studio/README.md` and made it the visible panel.
- Clicking `abspath` opened `/home/avatsaev/DEV/avatsaev/pi-studio/package.json` (absolute path used
  as-is) and made it visible.
- Clicking `tildepath` opened `/home/avatsaev/DEV/avatsaev/pi-studio/AGENTS.md` — correct expansion
  against the daemon's home dir (`/home/avatsaev`).
- `ext`/`anchor` carry no click interception (`onclick === null`), confirmed by DOM inspection —
  they remain ordinary links/in-page anchors.
- Clicking `relpath` a second time did **not** create a duplicate `README.md` tab — the existing tab
  (opened via the same chat message) was reused; the same tab id (`tabIds.file(path)`) the Files
  tree/context menu use guarantees convergence with any other route to the same path.

## Acceptance criteria
- [x] `[label](./notes.md)` with a resolvable asset base renders actionable; same for an absolute
      path and a `~`-prefixed path — verified live (relpath/abspath/tildepath all opened correctly).
- [x] `[docs](https://example.com)` renders as an ordinary external link — no interception, no
      `preventDefault` — verified live (`onclick === null`) and by unit test.
- [x] `[jump](#section)` renders as an ordinary in-page anchor — never intercepted — verified live and
      by unit test (`classifyFileLinkSrc("#section", ...) === { kind: "external" }`).
- [x] A relative link with no asset base renders as an ordinary anchor — unit-tested
      (`file-link-src.test.ts`, task-001; re-asserted in `markdown.test.ts`).
- [x] Clicking an actionable link calls `openFileTab` with the normalized path and the owning tab's
      `workspaceCwd`, reusing an already-open tab for the same path — verified live (second
      `relpath` click reused the tab) and by `resolveFileOpenTarget` unit tests.
- [x] Clicking an actionable link opens into and focuses `owningPaneId` when non-null — verified live
      (single-pane case; `owningPaneId` threading itself is typechecked end-to-end per task-002).
- [x] The pre-existing inline-image click-to-open is verified with the same pane-targeting and
      workspace-cwd assertions — regression coverage added in `markdown.test.ts`'s "InlineImage
      regression" describe block, using the same `resolveFileOpenTarget` the live code now calls.
- [x] A tab not yet placed in any pane (`owningPaneId === null`) falls back to the pre-existing
      globally-focused-pane default without throwing — unit-tested (`resolveFileOpenTarget` converts
      `null` → `undefined`, `openFileTab`'s pre-existing `targetPaneId` fallback is unchanged).
- [x] `npm run build`, `npm run typecheck`, `npm run lint` pass.

## Follow-ups / TODO(verify)
- None. Drag-source wiring is task-004's scope, out of scope here per the task's own boundary.
