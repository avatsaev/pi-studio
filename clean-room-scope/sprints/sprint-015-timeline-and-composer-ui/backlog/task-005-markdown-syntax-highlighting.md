# Task 005 — Markdown rendering & syntax highlighting

- **Sprint:** sprint-015-timeline-and-composer-ui
- **Status:** backlog
- **Estimated size:** M
- **Depends on:** task-002

## Goal
Implement the markdown renderer used by assistant messages + tool output, and client-side syntax
highlighting for fenced code.

## Scope references
- `clean-room-scope/features/timeline-rendering.md` § Markdown feature support, § Syntax highlighting
- `clean-room-scope/features/feature-panels-ui.md` (shared code rendering)

## What to build
- The markdown renderer: the supported feature set per the doc (headings, emphasis, lists, task lists,
  block quotes, tables, links, inline code, fenced code blocks, horizontal rules, images) mapped to themed
  components; safe handling of partial/streaming markdown (don't crash on unbalanced fences); the
  platform-split markdown-text leaf.
- Fenced code blocks: language label, copy button, themed background, and syntax highlighting via the
  highlight package (consume server spans when present; else highlight client-side); long-line horizontal
  scroll; the appearance-style boundary repaints parsed content on theme/font change.
- Inline code chips.

## Out of scope
- Row dispatch/treatments (task-001,002). Tool cards (task-003). Diffs (task-004). Composer (task-006).

## Acceptance criteria
- [ ] All documented markdown features render with themed components and tolerate partial/streaming input.
- [ ] Fenced code is highlighted (server spans when present, client fallback otherwise) with a copy button
      and language label.
- [ ] Changing theme/font repaints already-parsed content (appearance boundary).

## Test / verification plan
- Tests: markdown feature coverage snapshot; streaming/unbalanced-fence resilience; highlight span
  application (pure).

## Notes
- Use `react-native-markdown-display` + `markdown-it` for markdown and `@av-pi-studio/highlight` for code
  (see design-system § UI technology stack). Exact highlighter grammar set is TODO(verify).
