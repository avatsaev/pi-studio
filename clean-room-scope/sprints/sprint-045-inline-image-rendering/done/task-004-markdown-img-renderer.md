# Task 004 — `InlineImage` renderer, `img` markdown override, and `assetBase` threading

- **Sprint:** sprint-045-inline-image-rendering
- **Status:** backlog
- **Estimated size:** M
- **Depends on:** task-002, task-003

## Goal
Make `![alt](path)` in a finalized assistant message render the actual image inline in the chat
timeline, with a skeleton while loading, a text fallback on failure, and click-to-open in a file tab.

## Background / why
`packages/web-client/src/timeline/markdown.tsx` already has exactly the seam this needs: react-markdown
with a per-tag override map, currently `components={{ code: CodeRenderer }}` (line 67). Adding
`img: InlineImage` is one entry — no restructuring.

The only real design question is how the renderer learns the directory that relative paths resolve
against. It is threaded as an **explicit optional prop**, not a React context: `grep -c createContext
packages/web-client/src` is currently **0**, so a context would be the first in the codebase, and only
one consumer needs the value. A prop also keeps `classifyImageSrc` and the component trivially
testable.

`Markdown` has three consumers today — `AssistantRow.tsx:26`, `ReasoningRow.tsx:25`, and
`MarkdownFileViewer.tsx:53`. Only the assistant row passes an asset base (see the scope's § Asset base
table for why reasoning rows deliberately do not).

`AssistantRow` renders raw text while `row.streaming` and only calls `Markdown` once the block
finalizes (see its own header comment). That is what keeps a half-typed `![](scr` from issuing
requests — depend on it, do not change it.

## Scope references
- `clean-room-scope/features/inline-image-rendering.md` § Public Contract → Asset base, Loading /
  error / interaction states; § Behavior & Algorithms → Render pipeline, Lazy loading; § Streaming
  interaction
- `clean-room-scope/features/timeline-rendering.md` § Row treatments (assistant message / markdown)
- `clean-room-scope/features/workspace-ui.md` § tab model (opening a file tab)

## What to build
- **`packages/web-client/src/timeline/InlineImage.tsx`** (new):
  ```ts
  export interface InlineImageProps {
    src?: string;
    alt?: string;
    assetBase: string | null;
  }
  ```
  - `classifyImageSrc(src, assetBase, homeDir)` (task-002), with `homeDir` from `useHomeDir()`.
  - `remote` → render a plain `<img src={src} alt={alt} />` (what react-markdown would have produced);
    **no** hook call, no daemon round trip.
  - `unresolvable` → the text fallback: `alt` when present, else the raw `src`, in inline monospace.
    No request.
  - `local` → `useInlineImage(path)` (task-003):
    - `loading`/`idle` → a fixed-height skeleton block (reuse an existing muted/skeleton style from the
      sibling viewers; do not introduce a new one) so the timeline does not jump as images resolve.
    - `ready` → `<img src={objectUrl} alt={alt}>` constrained to the timeline column width with
      `height: auto`, clickable → open the file tab (below).
    - `error` → the same text fallback as `unresolvable`.
  - Click on a ready image opens the file in a tab, exactly as the explorer does
    (`FileExplorer.tsx:85-100`): `useTabStore`'s open with `id: tabIds.file(path)`, `kind: "file"`,
    `data: { path }`, `workspaceCwd: assetBase || "~"`. Give the image a pointer cursor and a `title`
    with the resolved path.
- **`packages/web-client/src/timeline/markdown.tsx`**:
  - `MarkdownProps` gains `assetBase?: string | null` (default `null`).
  - Register `img` in the existing `components` map, bound to the current `assetBase`.
  - Keep `Markdown` memoized; `assetBase` must be part of what memo compares (it is a scalar, so the
    default shallow compare is enough — just do not wrap the components map in a way that mints a new
    object identity per render for no reason).
- **`packages/web-client/src/features/chat/Timeline.tsx`** — `renderRow` (line 30) takes the asset base
  as a second argument and passes it to `AssistantRow` only. `Timeline` already receives the whole
  `session`, so the value is `normalizeCwd(session.cwd, homeDir)`.
- **`packages/web-client/src/features/chat/rows/AssistantRow.tsx`** — new `assetBase: string | null`
  prop, forwarded to `Markdown`.
- **`ReasoningRow.tsx` and `MarkdownFileViewer.tsx`** — unchanged. They keep calling `Markdown` with no
  `assetBase`, which classifies every relative path as `unresolvable`. Absolute and `~` paths still
  render in both, which is the intended behavior.
- **`packages/web-client/src/timeline/markdown.module.css`** — styles for the inline image (max-width
  100%, auto height, small radius, subtle border so a white-background PNG reads as an image), the
  skeleton, and the fallback text span.

## Out of scope
- Passing the viewed file's directory as `MarkdownFileViewer`'s asset base (would make repository
  README images render). Desirable, tracked as a TODO(verify) in the scope, not this task.
- A lightbox / zoom / full-screen view.
- Any image in a **user** message row (user attachments already have their own rendering path).
- `IntersectionObserver`-based laziness — timeline virtualization already only mounts near-viewport
  rows, so mounting *is* the visibility signal.
- Copy/save/download affordances on the image.

## Acceptance criteria
- [ ] An assistant message containing `![shot](./shot.png)` in a session whose cwd holds that file
      renders the image inline, sized to the timeline column, aspect ratio intact.
- [ ] The same with `/abs/path/shot.png` and `~/shot.png` renders inline.
- [ ] `![x](https://example.com/a.png)` renders as an ordinary remote image and issues no daemon
      request.
- [ ] `![missing shot](nope.png)` renders `missing shot` as inline text — not a broken-image glyph —
      and does not retry in a loop.
- [ ] `![doc](notes.pdf)` renders the text fallback with no download attempted.
- [ ] A relative image path inside a reasoning/thinking row is never fetched.
- [ ] While an assistant block is streaming, no image request is issued; the image appears when the
      block finalizes.
- [ ] Clicking a rendered image opens that file in a file tab focused on the image viewer.
- [ ] The markdown file viewer still renders `.md` files exactly as before (no `assetBase` passed).
- [ ] `npm run build:web-client` and `npm run typecheck` pass.

## Test / verification plan
- Unit: `packages/web-client/src/timeline/InlineImage.test.tsx` (or `.test.ts` with the repo's existing
  render helper if there is one — match what `MoleculeViewer.test.ts` does) with `useInlineImage`
  mocked: asserts the four branches (remote passthrough, unresolvable fallback, loading skeleton, ready
  `<img>` with the object URL) and that `unresolvable`/`remote` never invoke the hook.
- Unit: extend/create `packages/web-client/src/timeline/markdown.test.tsx` — rendering
  `![a](./x.png)` with an `assetBase` produces the inline-image path, and with `assetBase: null`
  produces the fallback.
- Manual (folded into task-007): the real proof — a running daemon, a `.png` in the workspace, and an
  agent turn containing the markdown.
- Run: `npx vitest run packages/web-client/src/timeline`.

## Notes
- Constrain the rendered image's height as well as width (e.g. a max height around 60vh) so a tall
  screenshot does not push the rest of the turn off-screen; the click-to-open tab is the escape hatch
  for viewing it at full size.
- react-markdown passes `src`/`alt` as optional — handle `src === undefined` as `unresolvable` rather
  than asserting.
- Do not add `dangerouslySetInnerHTML` anywhere here. The existing use in `CodeBlock` is justified by
  Shiki's trusted output; an image needs no such escape.
