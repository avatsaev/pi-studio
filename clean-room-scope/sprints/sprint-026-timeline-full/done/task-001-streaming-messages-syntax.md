# Task 001 — Streaming message rendering & syntax highlighting

- **Sprint:** sprint-023-timeline-full
- **Status:** done
- **Estimated size:** L
- **Depends on:** sprint-024/task-003 (timeline subscription), sprint-016/task-005 (highlight)

## Goal
Build production-quality message rendering: streaming token append with cursor, markdown with
fenced code blocks syntax-highlighted via the highlight package, and smooth row height animation.

## Scope references
- `clean-room-scope/features/timeline-rendering.md` § streaming, § markdown, § syntax highlighting
- `clean-room-scope/features/ui-components.md` § code surfaces

## What to build
- **Streaming cursor**: as tokens arrive, append to the current assistant message content; show a
  blinking cursor at the end while streaming. Use requestAnimationFrame batching (16ms frames) to
  avoid excessive re-renders during fast streaming.
- **Markdown rendering**: use `react-markdown` (or the sprint-015 `parseMarkdownBlocks()` streaming-
  safe parser) to render paragraphs, headings, lists, links, blockquotes, tables, horizontal rules.
  Inline code uses mono font; block code delegates to syntax highlighter.
- **Syntax highlighting**: fenced code blocks (`\`\`\`lang`) render via the `@av-pi-studio/highlight`
  package tokenizer → span-based coloring. Support top-N languages (TypeScript, JavaScript, Python,
  Rust, Go, JSON, YAML, Bash, SQL, HTML, CSS, Markdown).
- **File link detection**: detect inline file paths in assistant messages (via `detectInlinePathLinks`);
  render as clickable links that open the file in a preview tab.
- **Copy button**: each code block has a hover-revealed "Copy" button (copies to clipboard).
- **Row height management**: virtualized rows need accurate height estimates; use
  `measureElement` from `@tanstack/react-virtual`; streaming rows re-measure on content change.

## Acceptance criteria
- [ ] Streaming tokens appear smoothly with blinking cursor; no janky re-renders.
- [ ] Markdown renders correctly: headings, lists, code blocks, links, tables.
- [ ] Code blocks are syntax-highlighted with correct language detection; copy button works.
- [ ] File paths are clickable and open in preview tab.
- [ ] Virtualized list correctly measures growing rows during streaming.

## Test / verification plan
- Streaming: emit 100 tokens at 10ms intervals → verify smooth render (no dropped frames on 60Hz).
- Markdown: snapshot tests for each markdown element type.
- Highlight: verify token count/coloring for a TypeScript snippet.
- Copy: click copy button → verify clipboard content.
