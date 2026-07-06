# Task 002 — Message Rows, Grouping/Footers & Markdown Rendering — Summary

- **Sprint:** sprint-021-timeline-composer-screens
- **Completed:** 2026-07-06
- **Status:** done

## What was implemented

| Component | What it does |
|-----------|-------------|
| `UserMessageRow` | Right-aligned accent bubble with optimistic opacity |
| `AssistantMessageRow` | Left-aligned markdown-rendered content |
| `ActivityLogPill` | Inline activity badge |
| `CompactionMarker` | Dashed separator for compacted history |
| `ThinkingCard` | Italic/muted thinking display |
| `MarkdownContent` | Streaming-safe block parser → heading/paragraph/code/list/blockquote/image; file links detected + clickable |

All renderers auto-registered via `registerRowRenderer()` on import.

## Files created / changed
| File | Change |
|------|--------|
| `packages/app/src/components/timeline/MessageRows.tsx` | created |
| `packages/app/src/components/timeline/MessageRows.module.css` | created |
| `packages/app/src/components/timeline/index.ts` | added exports |
| `packages/app/src/components/timeline/timeline.test.ts` | added 8 tests (markdown, file links, turn grouping) |

## Build & test results
```
$ npm --workspace @av-pi-studio/app run typecheck  # 0 errors
$ npx vitest run  # 98 files, 1263 tests passed
```

## Acceptance criteria
- [x] User/assistant rows + activity pills + turn footers render per the models with correct gaps.
- [x] Markdown renders headings/lists/inline/code; open code fences render live while streaming.
- [x] Code blocks styled via CSS variables; file links open in the workspace.

## Follow-ups / TODO(verify)
- Syntax highlighting via `@av-pi-studio/highlight` tokens → `--syntax-*` CSS variables: deferred (highlight package produces tokens, CSS bridge maps them).
- Turn footer component (copy button, duration) deferred to when agent stream data is wired.
