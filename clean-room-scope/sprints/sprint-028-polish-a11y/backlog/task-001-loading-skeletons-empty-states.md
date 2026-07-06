# Task 001 — Loading skeletons, empty states & error boundaries

- **Sprint:** sprint-028-polish-a11y
- **Status:** backlog
- **Estimated size:** L
- **Depends on:** sprints 023–027

## Goal
Add polished loading skeletons, meaningful empty states, and per-component error boundaries
across all screens and panels.

## Scope references
- `clean-room-scope/features/ui-components.md` § loading states, § empty states
- `clean-room-scope/architecture/design-system.md` § feedback patterns

## What to build
- **Skeleton components**: `SkeletonLine`, `SkeletonBlock`, `SkeletonAvatar`, `SkeletonCard`.
  Shimmer animation using CSS `@keyframes` + gradient. Compose into screen-specific skeletons:
  - `SessionsListSkeleton` (3–5 list items)
  - `TimelineSkeleton` (alternating message bubbles)
  - `ExplorerSkeleton` (indented lines)
  - `SettingsSkeleton` (label + control pairs)
- **Empty states**: meaningful illustrations + messages for:
  - No sessions: "No active sessions. Start a new workspace to begin."
  - No files: "This directory is empty."
  - No schedules: "No schedules configured."
  - No git repo: "This workspace is not a git repository."
  - No PR: "No pull request associated with this branch."
  - Connection lost: "Reconnecting to daemon…" with spinner.
- **Error boundaries**: wrap each route and each pane in `ErrorBoundary` that catches render
  errors. Show fallback UI: "Something went wrong" + error message + "Reload" button. Log
  errors to console with component stack.
- **Suspense integration**: wrap lazy-loaded panels in Suspense with skeleton fallback.
- **Retry logic**: error boundaries offer "Retry" that resets error state and re-renders children.

## Acceptance criteria
- [ ] Every screen shows a skeleton while loading (not blank white).
- [ ] Empty states show helpful messages + actions (e.g. "Create schedule" button).
- [ ] Errors in one panel don't crash the entire app; fallback UI shown with retry.
- [ ] Suspense boundaries work for code-split panels.

## Test / verification plan
- Skeletons: mock loading state → verify skeleton renders (not blank).
- Empty: mock empty data → verify empty state message.
- Error boundary: throw in child → verify fallback UI; click retry → verify re-render.
