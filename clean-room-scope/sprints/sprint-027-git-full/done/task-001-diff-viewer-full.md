# Task 001 — Full diff viewer with syntax highlighting & scroll sync

- **Sprint:** sprint-024-git-full
- **Status:** done
- **Estimated size:** L
- **Depends on:** sprint-023/task-002 (git hooks), sprint-029/task-001 (syntax highlighting)

## Goal
Build the production diff viewer: unified and side-by-side (split) modes with full syntax
highlighting, line-level scroll sync, word-level diff highlighting, and binary/too-large
placeholders.

## Scope references
- `clean-room-scope/features/feature-panels-ui.md` § diff viewer
- `clean-room-scope/features/git-checkout.md` § diff rendering

## What to build
- **Unified view**: single column, old/new line gutters, colored add/remove backgrounds, syntax-
  highlighted code (tokenized via highlight package). Wrap toggle. Collapsible unchanged ranges
  (show "... N lines hidden" between hunks).
- **Split (side-by-side) view**: two columns (old left, new right) with scroll-locked sync.
  Aligned blank lines for insertions/deletions. Both columns syntax-highlighted.
- **Word-level diff**: within changed lines, highlight the specific changed words/characters with
  deeper background color (green-on-light-green for adds, red-on-light-red for removes).
- **Binary placeholder**: for binary files, show "Binary file, N bytes" with no diff.
- **Too-large placeholder**: files > 500KB show "File too large to diff" with option to "Show anyway".
- **Scroll-to-change**: button to jump to next/previous change within the diff.
- **Copy hunk**: hover on hunk header → copy button copies that hunk to clipboard.
- **Integration**: wire to `useGitDiff(serverId, cwd, filePath)` hook from sprint-023.

## Acceptance criteria
- [ ] Unified mode renders with gutters, syntax highlighting, and collapsed unchanged ranges.
- [ ] Split mode renders two synchronized columns with alignment.
- [ ] Word-level highlighting shows within changed lines.
- [ ] Binary/too-large files show appropriate placeholders.
- [ ] Scroll-to-change navigates between hunks.

## Test / verification plan
- Render tests: sample diffs → verify correct line counts, gutter numbers, coloring.
- Word diff: "hello world" → "hello earth" → verify "world"/"earth" highlighted.
- Binary: detect binary file → verify placeholder rendered.
- Split scroll: scroll left column → verify right follows.
