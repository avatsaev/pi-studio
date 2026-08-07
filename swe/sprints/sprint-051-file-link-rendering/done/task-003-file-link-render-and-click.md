# Task 003 — `FileLink` component, `a` markdown override, converged click-to-open

- **Sprint:** sprint-051-file-link-rendering
- \*\*Status:\*\* done
- **Estimated size:** M
- **Depends on:** task-001, task-002

## Goal
Render `classifyFileLinkSrc`'s `local` results as actionable, pane-targeted click-to-open elements
via a new `a` markdown node override, and converge `InlineImage`'s hand-rolled click-to-open onto
the same shared dispatch so the pane-targeting fix lands once for both features.

## Background / why
`file-link-rendering.md` § Render pipeline:
```
finalized assistant markdown block
  -> markdown renderer, with an `a` node override registered alongside the existing `img`/`code`
     overrides
  -> classifyFileLinkSrc(href, assetBase, homeDir)
       external    -> default <a>, unmodified
       local(path) -> actionable: on click, preventDefault + open-file dispatch, target = owning pane
```
Today `InlineImage.tsx`'s `handleClick` hand-rolls `useTabStore.getState().open(...)` directly
(`workspaceCwd: assetBase || "~"`, no target pane) instead of calling the shared `openFileTab`
dispatch (`packages/web-client/src/features/files/open-file-tab.ts`) the Files tree and its context
menu already use. Converging both onto `openFileTab` — with `owningPaneId` and `workspaceCwd`
available from task-002 — puts the pane-targeting fix in exactly one place for both features, as
the spec's amendment to `inline-image-rendering.md` § Click-to-open requires. Per that amendment,
the dispatch's workspace argument is the **owning chat tab's workspace cwd**, never the
`assetBase || "~"` approximation.

## Scope references
- `clean-room-scope/features/file-link-rendering.md` § Render pipeline, § Click-to-open pane
  targeting (both implementation notes: converged dispatch, workspace-cwd argument), § Error
  Handling & Edge Cases (fragment/scheme/no-base/missing-file/`~`-before-homedir rows)
- `clean-room-scope/features/inline-image-rendering.md` § Click-to-open (amended)
- `packages/web-client/src/timeline/file-link-src.ts` (task-001)
- `packages/web-client/src/features/files/open-file-tab.ts` — `openFileTab(path, workspaceCwd,
  targetPaneId?)`, the shared dispatch both must call (`targetPaneId` is `string | undefined`;
  convert `owningPaneId ?? undefined` at each call site)
- `packages/web-client/src/timeline/markdown.tsx:61-76` (now carrying `owningPaneId` +
  `workspaceCwd` per task-002)
- `packages/web-client/src/timeline/InlineImage.tsx` (click handler to converge)
- `packages/web-client/src/hooks/use-home-dir.ts`

## What to build
- New `packages/web-client/src/timeline/FileLink.tsx`:
  ```ts
  export interface FileLinkProps {
    href?: string;
    children?: React.ReactNode;
    assetBase: string | null;
    owningPaneId: string | null;
    workspaceCwd: string | null;
  }
  ```
  Classify via `classifyFileLinkSrc(href || "", assetBase, homeDir)`. `external` → plain
  `<a href={href}>{children}</a>`, unmodified. `local(path)` → an actionable anchor whose `onClick`
  calls `event.preventDefault()` then
  `openFileTab(path, workspaceCwd ?? (assetBase || "~"), owningPaneId ?? undefined)`. The chat
  render path always threads a real `workspaceCwd` (task-002); the `assetBase || "~"` fallback
  exists only for markdown surfaces outside any tab, where no owning tab exists to name — the spec's
  "never the approximation" clause governs the chat dispatch, which never hits the fallback.
- `markdown.tsx`: add `a: (props) => <FileLink {...props} assetBase={assetBase}
  owningPaneId={owningPaneId} workspaceCwd={workspaceCwd} />` to the `components` map alongside
  `code`/`img`; the `img` override passes the same two props to `InlineImage` (wired in task-002).
- `InlineImage.tsx`: replace the hand-rolled `useTabStore.getState().open(...)` block in
  `handleClick` with `openFileTab(view.path, workspaceCwd ?? (assetBase || "~"), owningPaneId ??
  undefined)`; drop the now-unused direct `useTabStore` import if nothing else in the file needs it.

## Out of scope
- Drag-source wiring on `FileLink`/`InlineImage` (task-004).
- Any further change to `classifyFileLinkSrc` (task-001 already landed it).

## Acceptance criteria
- [ ] `[label](./notes.md)` with a resolvable asset base renders actionable; same for an absolute
      path and a `~`-prefixed path.
- [ ] `[docs](https://example.com)` renders as an ordinary external link — no interception, no
      `preventDefault`.
- [ ] `[jump](#section)` renders as an ordinary in-page anchor — never intercepted, even with a
      valid asset base.
- [ ] A relative link with no asset base renders as an ordinary anchor.
- [ ] Clicking an actionable link calls `openFileTab` with the normalized path (task-001) and the
      owning tab's `workspaceCwd` — reusing an already-open tab for the same path opened via a
      different route (e.g. the Files tree) rather than duplicating it.
- [ ] Clicking an actionable link opens into and focuses `owningPaneId` when non-null, never a
      different globally-focused pane.
- [ ] The pre-existing inline-image click-to-open is verified with the same pane-targeting and
      workspace-cwd assertions — regression coverage for the shared fix, not just new-feature
      coverage.
- [ ] A tab not yet placed in any pane (`owningPaneId === null`) falls back to the pre-existing
      globally-focused-pane default without throwing.
- [ ] `npm run build`, `npm run typecheck`, `npm run lint` pass.

## Test / verification plan
- Unit: `FileLink` classification→dispatch behavior (no jsdom — extract "given classification +
  owningPaneId + workspaceCwd, what does `openFileTab` get called with" into a pure function per
  the project's established pure-core-over-jsdom convention, mirrored from `markdown.test.ts`'s
  existing integration-without-render style).
- Unit: extend/add an `InlineImage` test asserting the converged call passes `owningPaneId` and
  `workspaceCwd` through to `openFileTab`.
- Run: `npx vitest run packages/web-client/src/timeline`.
- Manual: against a running daemon + web-client, post an assistant message containing a relative,
  absolute, and `~`-prefixed file link plus an external link and an in-page anchor; confirm each
  renders/behaves per the acceptance criteria and clicking opens into the pane the message is
  displayed in.

## Notes
`openFileTab`'s `targetPaneId` is `string | undefined`, not `string | null` — always convert at the
call site rather than changing `openFileTab`'s signature.
