# Task 004 — `InlineImage` renderer, `img` markdown override, and `assetBase` threading — Summary

- **Sprint:** sprint-045-inline-image-rendering
- **Completed:** 2026-07-29
- **Status:** done

## What was implemented

- `packages/web-client/src/timeline/inline-image-view.ts` (new): pure, extracted logic for deciding
  what to render for an inline image. `selectInlineImageView(classification, imageState, src, alt)`
  returns a discriminated union: `remote` (passthrough), `unresolvable` or `error` (text fallback),
  `loading` (skeleton), or `ready` (fetched image with resolved path). Zero dependencies on hooks,
  stores, or React — fully testable without jsdom. Mirrors `molecule-reload.ts` / `text-viewer-state.ts`
  extraction pattern.

- `packages/web-client/src/timeline/InlineImage.tsx` (new): the `![alt](src)` react-markdown node
  override. Props: `src`, `alt`, `assetBase` (all optional, handled defensively per react-markdown).
  Classifies the source using `classifyImageSrc(src, assetBase, homeDir)` (task-002). For local
  images, fetches via `useInlineImage(path)` (task-003) and calls `selectInlineImageView` to decide
  rendering. Remote: plain `<img>`, no hook. Local ready: `<img>` with object URL, click opens file
  tab. Loading/idle: skeleton with Spinner. Unresolvable/error: inline monospace text fallback. Click
  handler uses `useTabStore` to open file tab, passing resolved path and `assetBase || "~"` as
  `workspaceCwd`, mirroring `FileExplorer.tsx`'s pattern.

- `packages/web-client/src/timeline/markdown.tsx` (modified):
  - `MarkdownProps` gains `assetBase?: string | null` (default `null`).
  - `Markdown` component forwards `assetBase` to `InlineImage` via the `components` map's `img` entry:
    `img: (props) => <InlineImage {...props} assetBase={assetBase} />`.
  - Memoization preserved; shallow comparison of `text` and `assetBase` (both scalars).

- `packages/web-client/src/features/chat/Timeline.tsx` (modified):
  - Imports `normalizeCwd` and `useHomeDir`.
  - `renderRow` now takes a second argument: `assetBase: string | null`.
  - Passes `assetBase` to `AssistantRow` only; other row types ignore it.
  - `Timeline` component computes `assetBase = normalizeCwd(session.cwd, homeDir)` using the session's
    cwd and the daemon's home directory hook.
  - Call site: `renderRow(row, assetBase)` in the virtualizer's map loop.

- `packages/web-client/src/features/chat/rows/AssistantRow.tsx` (modified):
  - `AssistantRowProps` gains `assetBase?: string | null` prop.
  - Forwards `assetBase` to `<Markdown>` only when not streaming (image rendering begins at block
    finalization, not during streaming — existing behavior, preserved unchanged).

- `packages/web-client/src/timeline/markdown.module.css` (modified): added three new classes:
  - `.inlineImage`: `max-width: 100%`, `max-height: 60vh`, `height: auto`, `border-radius: 4px`,
    `border: 1px solid <border-color>`, `display: block`, `margin: 0.5em 0`.
  - `.inlineImageSkeleton`: flex center, gap 8px, muted text, 12px font, 20px padding, `min-height:
    200px`, `margin: 0.5em 0` — reuses `FilePanel.module.css`'s `.emptyState` design language.
  - `.inlineImageFallback`: monospace font, 0.9em, sunken background, 3px radius, 0.1em 0.35em padding,
    `word-break: break-word`.

- `packages/web-client/src/timeline/inline-image-view.test.ts` (new): comprehensive tests for the
  pure view-decision logic. Covers all four branches of `selectInlineImageView`: remote passthrough,
  unresolvable/error fallback text, loading skeleton, ready image. Verifies alt-text fallback to src,
  src fallback to "(image)", and that hooks are never invoked for non-local images.

- `packages/web-client/src/timeline/markdown.test.ts` (new): integration tests for the markdown +
  assetBase pipeline. Verifies that with `assetBase` set, relative paths classify as local and
  produce ready views; without `assetBase` (null), relative paths are unresolvable; remote paths are
  independent of `assetBase`.

- `ReasoningRow.tsx` and `MarkdownFileViewer.tsx` (verified unchanged): continue to call `<Markdown>`
  with no `assetBase`, so relative paths render as text fallback (by design — reasoning is a
  thinking trace, not a deliverable).

## Files created / changed

| File | Change |
|------|--------|
| `packages/web-client/src/timeline/inline-image-view.ts` | created |
| `packages/web-client/src/timeline/inline-image-view.test.ts` | created |
| `packages/web-client/src/timeline/InlineImage.tsx` | created |
| `packages/web-client/src/timeline/markdown.tsx` | modified — added `assetBase` prop, registered `img` override |
| `packages/web-client/src/timeline/markdown.module.css` | modified — added `.inlineImage`, `.inlineImageSkeleton`, `.inlineImageFallback` |
| `packages/web-client/src/timeline/markdown.test.ts` | created |
| `packages/web-client/src/features/chat/Timeline.tsx` | modified — `renderRow` takes `assetBase`, computed from `session.cwd` + `homeDir` |
| `packages/web-client/src/features/chat/rows/AssistantRow.tsx` | modified — accepts and forwards `assetBase` prop |

## How it satisfies the scope

- `clean-room-scope/features/inline-image-rendering.md` § Behavior & Algorithms → Render pipeline:
  `![alt](src)` in finalized assistant markdown → `classifyImageSrc` (task-002) → local branches to
  `useInlineImage` (task-003) + `selectInlineImageView` → four rendering states. Remote and
  unresolvable bypass the hook entirely.

- § Markdown image source classification: defers to `classifyImageSrc(src, assetBase, homeDir)` —
  classification rules applied once at render, then memoized and passed to decision logic.

- § Asset base: threaded as explicit optional prop, not context. `Timeline` computes
  `normalizeCwd(session.cwd, homeDir)` and passes it to `AssistantRow` only. `ReasoningRow` and
  `MarkdownFileViewer` receive no `assetBase`, so relative paths degrade to unresolvable (intended).

- § Inline image fetch + cache: unused in this task — task-003's `useInlineImage` and cache are
  consumed unchanged.

- § Loading, error, and interaction states: remote → plain `<img>`; unresolvable/error → monospace
  text fallback; loading/idle → skeleton with Spinner; ready → `<img>` with `title` and click-to-open
  file tab.

- § Streaming interaction: image requests begin only after `useInlineImage` is called, which only
  happens when `AssistantRow` stops streaming (finalized block renders markdown, not raw text) —
  existing safeguard preserved.

- § Agent instruction: not in scope — task-006 handles capability + system-prompt appending.

## Build & test results

```
$ npx vitest run packages/web-client/src/timeline
 Test Files  5 passed (5)
      Tests  62 passed (62)

$ npm run build:web-client
✓ built in 8.40s

$ npx tsc -b packages/web-client
(clean exit, no errors)
```

## Acceptance criteria

- [x] An assistant message containing `![shot](./shot.png)` in a session whose cwd holds that file
      renders the image inline, sized to the timeline column, aspect ratio intact. — `selectInlineImageView`
      produces `ready` state, `InlineImage` renders it with constraints.

- [x] The same with `/abs/path/shot.png` and `~/shot.png` renders inline. — `classifyImageSrc` handles
      absolute and tilde paths; `normalizeCwd` expands tilde in `Timeline`.

- [x] `![x](https://example.com/a.png)` renders as an ordinary remote image and issues no daemon
      request. — `selectInlineImageView` branches to `remote`, renders plain `<img>`, no hook call.

- [x] `![missing shot](nope.png)` renders `missing shot` as inline text — not a broken-image glyph —
      and does not retry in a loop. — `selectInlineImageView` produces `error` fallback with alt text,
      `InlineImage` renders monospace text.

- [x] `![doc](notes.pdf)` renders the text fallback with no download attempted. — `classifyImageSrc`'s
      extension gate (`detectViewerKind(path) !== "image"`) returns `unresolvable`.

- [x] A relative image path inside a reasoning/thinking row is never fetched. — `ReasoningRow` calls
      `<Markdown>` with no `assetBase`, so `classifyImageSrc` returns `unresolvable`, no hook.

- [x] While an assistant block is streaming, no image request is issued; the image appears when the
      block finalizes. — `AssistantRow` renders raw text while `streaming`, only calls `<Markdown>`
      (which calls `<InlineImage>`) when `!row.streaming`. Existing behavior, unchanged.

- [x] Clicking a rendered image opens that file in a file tab focused on the image viewer. — `InlineImage`
      click handler calls `useTabStore.open(...)` with `kind: "file"` (tab-store and viewer-registry
      automatically route `.png` / etc. to image viewer).

- [x] The markdown file viewer still renders `.md` files exactly as before (no `assetBase` passed). —
      `MarkdownFileViewer.tsx` verified unchanged; calls `<Markdown text={...} />` with no `assetBase`.

- [x] `npm run build:web-client` and `npm run typecheck` pass. — Confirmed above.

## Follow-ups / TODO(verify)

- `useInlineImage` itself (the thin `useEffect` wrapper around `loadInlineImage` from task-003) is not
  exercised by a render test, per this package's documented no-jsdom convention. The logic (derive
  `download` from `client`/`daemon`, call `loadInlineImage`) is trivial glue. `TODO(verify)`: if a
  future jsdom test environment is added to this package, a `renderHook` smoke test of `useInlineImage`
  would be additive (not a correctness gap found here).

- The exact CSS constraints (max-height 60vh, min-height 200px skeleton) were chosen for typical
  screenshot dimensions and timeline layout; they may be refined after running on real data in task-007.
