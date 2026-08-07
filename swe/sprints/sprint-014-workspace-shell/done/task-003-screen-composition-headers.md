# Task 003 — Workspace screen composition, headers & actions

- **Sprint:** sprint-014-workspace-shell
- **Status:** done
- **Estimated size:** M
- **Depends on:** task-002

## Goal
Compose the workspace screen (header + tab strip + pane content + explorer sidebar) and implement the
header actions.

## Scope references
- `clean-room-scope/features/workspace-ui.md` § Top-level layout, § Desktop tab strip, § Primary header,
  § Scripts button, § Open-in-editor, § Bulk close

## What to build
- Center-column composition: primary screen header (hidden in focus mode unless mobile) + tab strip
  (per-pane on web / single on non-web desktop) + pane content area; flanking explorer sidebar (wide);
  workspace-focus provider + root modals (import sheet, rename modal).
- Desktop tab strip: width distribution (icon-min..200, horizontal scroll fallback), chip (icon + status
  dot + label + close + context menu + tooltip; middle-click close on web), trailing actions (new agent /
  terminal / browser [Electron] / split right/down), sortable reorder via the shared drag context.
- Primary header: sidebar toggle + title bar (branch switcher + project subtitle + workspace `⋯` menu);
  right cluster (scripts button, open-in-editor split button, git actions + explorer toggle w/ diff-stat,
  or plain explorer toggle); icon-only collapse at narrow widths; mobile = explorer toggle only.
- Scripts button (split desktop / ghost mobile; Start vs View + service URL), open-in-editor (web + absolute
  cwd; preferred editor + targets), bulk close (classify + confirmation wording + server close/archive +
  local cleanup + closing spinner).

## Out of scope
- Tab model/reconciliation (task-001). Splits/LRU (task-002). Seeding/gating + mobile switcher (task-004).
  Panel internals (sprints 016–017).

## Acceptance criteria
- [ ] The header shows the branch switcher, the workspace `⋯` menu, and the right-cluster actions per
      git/non-git + form factor.
- [ ] The desktop tab strip distributes widths, supports context menu + middle-click close, and shows the
      trailing actions cluster.
- [ ] Bulk close archives agents and closes terminals server-side with the correct confirmation.

## Test / verification plan
- Tests: tab-width layout; tab menu entry building (desktop/mobile, end-of-list disabling); bulk-close
  classification + confirmation message.

## Notes
- Scripts-start RPC + service-URL resolution details are TODO(verify).
