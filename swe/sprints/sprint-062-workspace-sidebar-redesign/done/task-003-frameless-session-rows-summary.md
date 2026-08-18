# Task 003 — Frameless session rows + selection / activity states — Summary

- **Sprint:** sprint-062-workspace-sidebar-redesign
- **Completed:** 2026-08-18
- **Status:** done

## What was implemented

`SessionItem` rebuilt as design spec § 03's frameless two-line row, driven entirely by
`sidebarSessionView(session)` (task-001) rather than raw `SessionEntry` fields: a title row (label
+ `StatusDot` from `view.dot` + the reserved-box `⋮`, via `Icon`) and a meta row (`view.meta` plus
a muted `· <reason>` segment when `view.reason` is set). `view.titleItalic` renders the title
italic; the `cwd`/`agentId`/`userMessageCount` meta line is gone entirely. The idle fill is a 60%
`surface0` mix, hovering to solid `surface0`, `radius-sm`, no border. The selected row carries all
four signals: 34% `accent` fill, a 32%-`accentBright` inset ring, `accentForeground` bold title,
and a 2px full-height `accentBright` left bar (`.activeBar`). A failed, unselected row gets a 10%
`destructive` tint with the meta label (not the reason) colored `destructive` — the selected fill
always wins when both apply. `.workspaceSessions` dropped its left-indent padding for spec's even
container padding + `gap`.

## Files created / changed

| File | Change |
|------|--------|
| `packages/web-client/src/features/sessions/SessionItem.tsx` | rewritten |
| `packages/web-client/src/features/sessions/SessionList.module.css` | modified (`.item*`, `.activeBar`, `.title*`, `.meta*`, `.menuBtn`, `.workspaceSessions`) |

## How it satisfies the scope

Implements every element of § 03's row contract in the task's build steps 1–8. Two deviations were
decided at planning time and are recorded per the task's Notes:

1. **The running-unselected row ships without the mock's half-opacity left bar** — only the
   spinning ring signals activity; the selected row keeps its bar. This drops a whole
   state-combination class while keeping "selection is fill, activity is the ring" strict.
2. **The selected row's ring color is `StatusDot`'s hardcoded `accentBright`**, not a bespoke
   white-on-accent per the mock — reusing the existing primitive over hand-rolling a variant, per
   § 07.

`accentForeground` (never a hardcoded white) is used for the selected title, satisfying § 07's
`zinc`-variant callout. `StatusDot` is the sole status-affordance primitive — no second dot/spinner
implementation anywhere in this file.

## Build & test results

```
$ npm run build:web-client
tsc -b && vite build
✓ built in 11.10s   (success — no tsc errors)

$ npx vitest run packages/web-client/src/features/sessions
✓ workspace-grouping.test.ts (3 tests)
✓ session-presentation.test.ts (20 tests)
Test Files  2 passed (2)
     Tests  23 passed (23)

$ npx vitest run packages/web-client/src/theme/token-integrity.test.ts packages/web-client/src/theme/font-scale.test.ts
✓ font-scale.test.ts (4 tests)
✓ token-integrity.test.ts (3 tests)
Test Files  2 passed (2)
     Tests  7 passed (7)

$ npx oxfmt --check packages/web-client/src/features/sessions/SessionItem.tsx packages/web-client/src/features/sessions/SessionList.module.css
All matched files use the correct format.

$ npx oxlint packages/web-client/src/features/sessions/SessionItem.tsx
(no errors)
```

Manual (browser, `npm run dev:daemon` mock provider + `npm run dev` web-client, a real two-session
workspace): screenshots confirm frameless rows with status-only meta ("idle", no cwd/agent/msg
count); clicking an unselected row moves the fill+bar+bold-title selection to it and the previous
row returns to its plain idle fill; creating a new chat renders an italic title with "no messages"
meta; sending a message through the mock provider round-trips and re-titles the row. The mock
provider resolves too fast to catch the intermediate `running` frame in a screenshot — that
transition is covered by task-001's unit tests (`sidebarSessionView` returning the running dot)
plus direct code review of the `view.dot && <StatusDot {...view.dot} />` pass-through, which
mirrors task-002's identical, already-manually-verified pattern for the workspace attention dot.

## Acceptance criteria

- [x] Rows are frameless (no border), `radius-sm`, evenly padded, no left indent; meta shows status
      only — no cwd, agent id, message count, timestamp, or cost (screenshot-verified; `.item` CSS
      has no `border`; `SessionItem.tsx` reads only `view.meta`/`view.reason`).
- [x] Idle fill is the 60% `surface0` mix; hover is solid `surface0` (`.item`/`.item:hover` rules).
- [x] Selected row shows all four signals — fill, inset ring, `accentForeground` bold title, 2px
      `accentBright` left bar — no hardcoded white (screenshot-verified fill/bar/bold; `.titleLabel`
      color is `var(--pi-color-accentForeground)`, never a literal).
- [x] A running, unselected row keeps the idle fill and shows the ring, no left bar — `.activeBar`
      only renders when `active` is true, independent of `view.state`.
- [x] A failed row shows the destructive tint, `turn failed`, and the reason when present, which
      ellipsises via the shared `.meta` `overflow:hidden`/`text-overflow:ellipsis`/`white-space:nowrap`.
- [x] A never-used session renders an italic title and `no messages` at `opacity-50`
      (screenshot-verified italic; `.metaEmpty { opacity: var(--pi-opacity-50) }`).
- [x] The `⋮` box is reserved (`flex-shrink: none`, fixed `IconButton` size) with no truncation
      shift on hover, and visible without hover below 575px / coarse pointer (media query rule).
- [x] Dragging behavior is untouched — `SessionItem` still receives `draggable`/`onDragStartRow`
      unchanged from `SessionList`, no code in this task touches drag wiring.

## Follow-ups / TODO(verify)

- The running state's spinning-ring appearance was not caught live in a screenshot (mock provider
  resolves near-instantly); covered by task-001's unit tests and code review, consistent with how
  task-002 handled the same limitation for the workspace attention dot. task-005's browser sweep
  re-checks this against a slower/streaming turn if one is available.
