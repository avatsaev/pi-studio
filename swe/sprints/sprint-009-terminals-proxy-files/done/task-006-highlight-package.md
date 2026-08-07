# Task 006 — Highlight package (server-side syntax highlighting)

- **Sprint:** sprint-009-terminals-proxy-files
- **Status:** done
- **Estimated size:** S
- **Depends on:** task-002 (sprint-001, build layering)

## Goal
Implement the server-side syntax-highlighting support package used by file previews and git diffs.

## Scope references
- `clean-room-scope/MAIN-SCOPE.md` § 3 (Highlight package), § 4 (`packages/highlight`)
- `clean-room-scope/features/file-explorer-transfer.md` (text preview), `clean-room-scope/features/git-checkout.md` (diff projection)

## What to build
- `packages/highlight`: a function that takes source text + a language/path hint and returns tokenized
  highlight spans (a stable, serializable shape consumable by file preview + diff rendering).
- Language detection from file extension/path; graceful plain-text fallback for unknown languages.

## Out of scope
- Client rendering of highlight spans (sprint-012). Diff projection itself (sprint-008 task-004).

## Acceptance criteria
- [ ] Highlighting a known language returns tokenized spans; an unknown language falls back to plain text.
- [ ] The output shape is serializable and stable for reuse by preview + diff.
- [ ] The package builds in the layered build (no dependency on server internals).

## Test / verification plan
- Tests: `npx vitest run packages/highlight/.../highlight.test.ts` — known language tokens, unknown
  fallback, deterministic output.

## Notes
- No dedicated scope file exists for highlight; this task is derived from MAIN-SCOPE module map. Exact
  highlighter library/grammar set is TODO(verify) against the original package.
