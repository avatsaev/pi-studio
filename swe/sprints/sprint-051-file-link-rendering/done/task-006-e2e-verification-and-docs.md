# Task 006 — E2E verification + docs sync

- **Sprint:** sprint-051-file-link-rendering
- **Status:** backlog
- **Estimated size:** S
- **Depends on:** task-001, task-002, task-003, task-004, task-005

## Goal
Confirm every acceptance-criteria checkbox in `file-link-rendering.md` passes end to end against a
real daemon + web-client, run the full gate suite once, and sync `AGENTS.md` files with the files
and behavior this sprint introduced.

## Background / why
This is the sprint's closing verification pass, mirroring sprint-045/task-007's role for the sibling
feature — the definition of done for the feature as a whole, not just its individual tasks, plus the
doc-sync obligation the root `AGENTS.md` requires. Per the sprint-045 precedent, all `AGENTS.md`
edits for the sprint are batched here.

## Scope references
- `clean-room-scope/features/file-link-rendering.md` § Acceptance Criteria, § Known Limitations
- `packages/web-client/AGENTS.md` (source-layout tree + the existing "Inline image rendering"
  subsection this sprint's sibling entry belongs next to)
- `packages/server/AGENTS.md` § Agent subsystem (currently documents the single-ternary composition
  task-005 replaces)
- `packages/protocol/AGENTS.md` (`CLIENT_CAPS` row — currently lists `custom_mode_icons`,
  `reasoning_merge_enum`, `terminal_reflowable_snapshot`, `inline_image_markdown`)

## What to build
- No new source logic — verification + documentation only.
- Sweep `file-link-rendering.md`'s `## Acceptance Criteria` list top to bottom; for each box,
  identify the task(s) implementing/testing it and confirm an automated test from that task exercises
  it. All boxes should already be covered by tasks 001-005's own test plans — this task's job is to
  confirm, not newly implement, and to catch any gap.
- Update `packages/protocol/AGENTS.md`: add `file_link_markdown` to the `CLIENT_CAPS` row (the code
  edit landed in task-005; the doc row lands here with the rest of the sprint's doc sync).
- Update `packages/web-client/AGENTS.md`:
  - Add `file-link-src.ts`, `href-resolution.ts`, and `FileLink.tsx` to the `timeline/`
    source-layout tree, matching the existing `image-src.ts`/`InlineImage.tsx` entries; note
    `lib/paths.ts`'s new dot-segment collapser in its existing description.
  - Add a "File link rendering" subsection near "Inline image rendering", describing
    `classifyFileLinkSrc`'s two-way split, the `a` override, the converged click-to-open dispatch
    (`openFileTab` with the owning tab's `workspaceCwd` + `owningPaneId`), the
    `owningPaneId`/`workspaceCwd` propagation chain, and the drag-to-split wiring.
  - Note the capability-gate line: `connection-store.ts` advertises `CLIENT_CAPS.file_link_markdown`
    unconditionally, same pattern as `inline_image_markdown`.
- Update `packages/server/AGENTS.md`'s agent-service.ts description to describe
  `composeSystemPrompt`/`CAPABILITY_INSTRUCTIONS` instead of the retired single-flag ternary, and
  mention `file-link-instructions.ts` alongside `inline-image-instructions.ts`.
- E2E manual pass against a running daemon + web-client, covering: relative/absolute/`~` local links
  render actionable; external link and in-page anchor render unmodified; click reuses an existing
  tab and targets/focuses the owning pane (both for a link and for the pre-existing inline-image
  regression case); drag-to-edge splits, drag-to-center moves, drag-onto-existing-tab reuses; a
  web-client-created session's persisted config carries the file-link instruction after any caller
  prompt, a CLI-created session's does not.
- Run the full project gate suite once from the repo root:
  - `npm run build`
  - `npm run typecheck`
  - `npm run lint`
  - `npm test`

## Out of scope
- Fixing any **behavioral** gap this sweep surfaces beyond a trivial doc/comment fix — that means an
  earlier task's acceptance criteria were not actually met; stop and report rather than silently
  patching around it here.

## Acceptance criteria
- [ ] Every checkbox in `file-link-rendering.md` § Acceptance Criteria is confirmed satisfied, with
      the specific automated test (file + case) that proves it identified.
- [ ] `packages/protocol/AGENTS.md`'s `CLIENT_CAPS` row lists `file_link_markdown`.
- [ ] `packages/web-client/AGENTS.md` documents `file-link-src.ts`, `href-resolution.ts`,
      `FileLink.tsx`, the `a` override, the `owningPaneId`/`workspaceCwd` propagation, drag wiring,
      and the capability advertisement line.
- [ ] `packages/server/AGENTS.md` documents `composeSystemPrompt`/`CAPABILITY_INSTRUCTIONS` and
      `file-link-instructions.ts`, with no remaining reference to the retired single-flag ternary.
- [ ] `npm run build`, `npm run typecheck`, `npm run lint`, `npm test` all succeed from the repo root.
- [ ] Each § Known Limitations item is re-confirmed accurate: directory links still fall through to
      open-file with no special handling; the spawn-time instruction-binding asymmetry holds for both
      flags; no existence pre-check exists before click or drag.

## Test / verification plan
- Run: `npm run build && npm run typecheck && npm run lint && npm test` from the repo root.
- Manual: the E2E pass described above, against a live daemon (`npm start` or `npm run dev:daemon`)
  and the web-client dev server.

## Notes
If the full-suite run surfaces a regression not caught by an individual task's own gate (e.g. a
cross-package typecheck failure only visible at the root), fix it here if trivial (import path,
stale type), or drop back to the offending task and report a blocker if it is not.
