# Task 001 — Streaming message rendering & syntax highlighting — Summary

- **Sprint:** sprint-026-timeline-full
- **Completed:** 2026-07-06
- **Status:** done

## What was implemented

Production message rendering: streaming token accumulation with a frame-batched
flush + blinking cursor, syntax-highlighted fenced code blocks with a copy
button, and file-link detection in assistant text.

1. **Streaming (`timeline/streaming.ts`, pure).**
   - `appendDelta` / `applyStreamDelta` / `endStream` — accumulate token deltas
     (or full-text snapshots) into `{ text, streaming }`; `shouldShowCursor`
     + `STREAM_CURSOR` glyph.
   - `createFrameBatcher(flush, schedule, cancel)` — coalesces rapid `push()`
     calls into **at most one flush per animation frame** (only the latest value
     is delivered), so a fast token stream doesn't re-render per token. The
     scheduler is injected (`requestAnimationFrame` in the app, a controllable
     fake in tests). `flushNow` / `cancel` / `flushCount` included.

2. **Store delta accumulation.** `applyStreamEvent` now merges assistant/
   reasoning token deltas into the existing live row (via `mergeStreamingRow`):
   `delta` events append to the accumulated `text`; `text` snapshots replace;
   the `streaming` flag stays set until a `done`/`complete`/`final` event.

3. **Code blocks (`timeline/code-block.ts`, pure).** `buildCodeBlock` resolves
   the fence language (alias table) and returns highlighted lines via the
   existing `@av-pi-studio/highlight` bridge (server spans preferred);
   `isSupportedLanguage` covers the top-N set (ts/js/py/rs/go/json/yaml/sh/sql/
   html/css/md).

4. **Component wiring (`components/timeline/MessageRows.tsx`).**
   - `CodeBlockView` renders per-token colored spans (`tokenColorVar`) with a
     language header + hover-revealed **Copy** button (writes to clipboard, 2s
     "Copied" check).
   - `AssistantMessageRow` appends a blinking `STREAM_CURSOR` while streaming.
   - File paths in text remain clickable (existing `detectInlinePathLinks`).
   - CSS: `.copyBtn` (hover-reveal), `.codeLine`, `.streamCursor` (blink
     keyframes) added with `--pi-*` tokens only.

## Files created / changed

| File | Change |
|------|--------|
| `packages/app/src/timeline/streaming.ts` | created (accumulator + frame batcher) |
| `packages/app/src/timeline/streaming.test.ts` | created (8 tests) |
| `packages/app/src/timeline/code-block.ts` | created (highlight + copy model) |
| `packages/app/src/timeline/code-block.test.ts` | created (6 tests) |
| `packages/app/src/store/session-store.ts` | modified (`mergeStreamingRow` delta accumulation) |
| `packages/app/src/store/session-store.test.ts` | modified (+2 streaming tests) |
| `packages/app/src/components/timeline/MessageRows.tsx` | modified (code block highlight + copy, stream cursor) |
| `packages/app/src/components/timeline/MessageRows.module.css` | modified (copyBtn/codeLine/streamCursor) |
| `packages/app/src/timeline/index.ts` | modified (export streaming + code-block) |

## How it satisfies the scope

- **timeline-rendering.md § streaming** — token append with a trailing blinking
  cursor; RAF batching (16ms frames) via `createFrameBatcher` avoids excessive
  re-renders during fast streaming.
- **§ markdown** — existing streaming-safe `parseMarkdownBlocks` renders
  headings/lists/code/links/tables/blockquote/rule; inline code + file paths.
- **§ syntax highlighting** — fenced blocks tokenized via the highlight package
  with the alias table; token-kind → `--syntax-*` color var; mono font kept on
  code surfaces.
- **§ code surfaces (ui-components.md)** — hover-revealed copy button with a
  brief "Copied" confirmation.
- **File links** — `detectInlinePathLinks` renders clickable path spans that
  call `onFileClick` (opens a preview tab in the pane router).
- **Row measurement** — the `Timeline` virtualizer already uses
  `measureElement`, so growing streaming rows re-measure on content change.

### Deviations / boundaries
- The blinking cursor + copy interaction are exercised through the pure models
  (`STREAM_CURSOR`, `buildCodeBlock`, frame batcher); the React components are
  thin wrappers and are not render-tested (node-only test env, consistent with
  the existing suite). TODO(verify): visual smoothness under a real 60Hz stream.
- Assistant inline image resolution + lightbox remain as specced elsewhere and
  are unchanged here.

## Build & test results

```
$ npx tsc -b packages/app
(clean)

$ npx vitest run packages/app/src/timeline/streaming.test.ts \
    packages/app/src/timeline/code-block.test.ts \
    packages/app/src/store/session-store.test.ts
 Test Files  3 passed (3)
      Tests  43 passed (43)

$ npm run typecheck   # whole monorepo
(clean)

$ npm test
 Test Files  120 passed (120)
      Tests  1571 passed (1571)
```

## Acceptance criteria
- [x] Streaming tokens appear smoothly with blinking cursor; no janky
      re-renders — `createFrameBatcher` coalescing (100 pushes → 1 flush/frame,
      latest value) + `mergeStreamingRow` accumulation + `.streamCursor`.
- [x] Markdown renders correctly (headings, lists, code, links, tables) —
      existing `parseMarkdownBlocks` + `MarkdownBlockView`.
- [x] Code blocks syntax-highlighted with language detection; copy works —
      `buildCodeBlock` (`code-block.test.ts`) + `CodeBlockView` copy button.
- [x] File paths clickable, open in preview tab — `detectInlinePathLinks` +
      `onFileClick`.
- [x] Virtualized list measures growing rows — `Timeline` `measureElement`.

## Follow-ups / TODO(verify)
- Visual confirmation of streaming smoothness at 60Hz in a real browser.
- Assistant inline image resolution/caching path (tracked in scope TODO).
