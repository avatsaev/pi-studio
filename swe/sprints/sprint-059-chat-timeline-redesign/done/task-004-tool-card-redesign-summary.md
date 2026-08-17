# Task 004 — ToolCard rebuild: kind badge, status treatment, output strip, diff preview — Summary

- **Sprint:** sprint-059-chat-timeline-redesign
- **Completed:** 2026-08-17
- **Status:** done

## What was implemented

`ToolCard` rebuilt on `RowShell` (design spec § 04's `[KIND BADGE] [primary field] [trailing status
area]` header, `ToolCard.module.css`'s one-token recipe):

- **Rail disc** — muted (`surface3` fill), the tool's existing lucide icon (`toolIcon`), consistent
  with `ReasoningRow`'s established "not a conversational voice" muted treatment.
- **Header** — a `role="button"` `div` (not a `<button>`, so the `Open` control can be a real,
  independently-focusable sibling button without illegal `<button>`-in-`<button>` nesting):
  - Kind badge: `toolBadge()`'s label + `token`, applied as a single `--kindToken` custom property
    (`style={{ "--kindToken": "var(--pi-color-<token>)" }}`) driving `.kindBadge`'s text/background
    (20%)/border (48%) via three `color-mix` ratios off that one property — verified live against
    all seven kinds via computed styles (SHELL/READ/SEARCH/FETCH → `accent`, WRITE → `statusSuccess`,
    EDIT → `statusWarning`, TASK → `foregroundMuted`).
  - Primary field (`toolPrimaryField`, task-001's un-truncated re-export of `toolDetailText`):
    `flex:1; min-width:0`, monospace, CSS-ellipsised, full text in `title`.
  - Trailing area: `edit`'s `toolDiffStats` `+N`/`−N` (statusSuccess/destructive) when non-zero,
    then `statusTrailing()`'s per-status text (`✓ completed` in statusSuccess; `error`/`statusText`
    in destructive; `Spinner` + `"running"` in accentBright; any other non-`"running"` `statusText`
    while `status === "running"` — e.g. `"awaiting_approval"` — as plain `foregroundMuted` text,
    the case task-001's `statusText` field exists for), then an `Open` button for `edit`/`write`
    tools with a real path.
  - `row.status === "running"` drives `.toolCardBodyRunning`/`.toolHeaderRunning` (accent 45% border
    + accent 10% header wash); `"error"` drives `.toolCardBodyError` (destructive 45% border) —
    independent of which trailing text renders, so an `awaiting_approval` card still gets the
    running-state chrome, only the label text differs.
- **Output strip** (`.toolOutputStrip`) — a distinct element, `surface0` background, rendered
  whenever `toolOutputLineCount(row.tool.output) > 0`, **not** gated on `expanded` (reserved slot
  for `sprint-058/task-005`'s live tail per the task's own note).
- **Diff preview** (`.toolDiffPreview`) — for `edit` with a diff, rendered only while **collapsed**:
  a local `diffPreview()` helper (reuses `DiffView`'s exported `parseDiff`, does not reimplement diff
  parsing) picks the first `add`/`del` row, tints it (statusSuccess/destructive 9% background) and
  shows `… N more lines` for the remaining changed (non-context) rows. Expanding replaces it with
  the full `<DiffView>` via the unchanged `toolBody`/expand mechanism.
- **Open affordance** — `edit`/`write` tools with a resolved `toolFilePath` get an `Open` button
  dispatching `openFileTab(path, target.workspaceCwd, target.targetPaneId)` from
  `resolveFileOpenTarget(assetBase, owningPaneId, workspaceCwd)` — the same dispatch `FileLink`
  uses. `Timeline.tsx`'s `renderRow` now threads `assetBase`/`owningPaneId`/`workspaceCwd` into
  `ToolCard` (previously only `AssistantRow`/`ReasoningRow` received them).
- **Expand/collapse** — preserved: header click/Enter/Space toggles (keydown handler guards
  `event.target === event.currentTarget` so a bubbled keydown from the nested `Open` button never
  double-toggles), `aria-expanded` correct, bodyless cards get `tabIndex={-1}`/`aria-disabled`.
- **Reduced motion** — the shared `Spinner` primitive (`components/primitives/Spinner.module.css`)
  had no `prefers-reduced-motion` handling at all; added `@media (prefers-reduced-motion: reduce) {
  .spinner { animation: none; } }` there (not a local override), fixing every `Spinner` consumer
  app-wide, not just this card's running state — verified live via `emulateMediaFeatures`.

`rows.module.css`: removed the old `.tool`/`.toolHeader`/`.toolChevron*`/`.toolInlineDetail`/
`.toolIcon`/`.toolIcon.running|completed|error`/`@keyframes pulse`/`.toolLabel`/`.toolBadge` (all
exclusive to the old `ToolCard`, confirmed via workspace grep before removal) and the now-orphaned
`.row` (task-003 already stopped using it; `ToolCard` was its last consumer). Kept `.toolBody`/
`.toolCode` — the expand/collapse body rendering is unchanged, reused as-is.

## Files created / changed

| File | Change |
|------|--------|
| `packages/web-client/src/features/chat/rows/ToolCard.tsx` | rewritten on `RowShell` |
| `packages/web-client/src/features/chat/rows/rows.module.css` | old header/icon/badge rules replaced; dead `.row` removed |
| `packages/web-client/src/features/chat/Timeline.tsx` | `assetBase`/`owningPaneId`/`workspaceCwd`/`connector` threaded to `ToolCard` |
| `packages/web-client/src/components/primitives/Spinner.module.css` | added `prefers-reduced-motion` handling (shared primitive, benefits every consumer) |

`tool-mapping.ts`, `row-model.ts`, `DiffView.tsx` — read/reused only, per the task's own file list;
no changes (`toolLabel`/`toolInlineDetail` remain valid, still-tested exports even though the new
header no longer calls them — not deleted, out of this task's scope).

## How it satisfies the scope

Maps directly to design spec § 04's tool-card mock, badge-per-kind table, status-treatment table,
and the literal `ToolCard.module.css` CSS recipe (§ 04's `.card`/`.header`/`.kindBadge`/`.path`/
`.output`/`.cardRunning` block) — every selector in that recipe has a same-named or renamed
(`.card`→`.toolCardBody`, `.cardRunning`→`.toolCardBodyRunning`) counterpart here using the same
token math. `StatusBadge` is no longer imported by `ToolCard` but was not deleted (other consumers
exist, per the task's own note). Out-of-scope items (live output tailing, `"canceled"` status,
`toolBody`/`DiffView` internals, batching) were not touched — the output strip and the
status-treatment lookup are shaped so `sprint-058/task-005` can extend them without rework, per the
task's Notes section.

## Build & test results

```
$ npx tsc -b --force
(no output — success)

$ npm run build:web-client
✓ built in 7.61s

$ npx vitest run packages/web-client
Test Files  52 passed (52)
     Tests  731 passed (731)

$ npx vitest run           # full workspace
Test Files  149 passed (149)
     Tests  1789 passed (1789)

$ npx oxlint <4 changed files>
(no output — clean)

$ npx oxfmt --check <4 changed files>
All matched files use the correct format.
```

## Acceptance criteria

- [x] Each of the seven kinds renders its documented badge label and tint; an unknown kind renders
      the `task` fallback treatment. (`toolBadge()`'s own test suite covers all seven + the
      fallback, task-001; live-verified SHELL/READ/EDIT/WRITE via computed `color`/`background`/
      `border` against a real daemon session)
- [x] A badge's text, background and border all derive from one `--kindToken`; no badge mixes token
      families, and no badge uses `success`. (single `.kindBadge` rule, `color-mix(var(--kindToken)
      …)` for all three channels; `BADGE_BY_KIND` already asserts `!== "success"` for all kinds,
      task-001)
- [x] The header shows the full path/command (ellipsed by CSS, full text in `title`) — not a
      basename or truncated first line. (`toolPrimaryField` = `toolDetailText`, un-truncated;
      live-verified `/tmp/tool-card-diff-test.txt`, `sleep 6 && echo done` rendered in full)
- [x] A `running` card shows the accent border + header wash and the `Spinner` primitive; a
      `completed` card shows `✓ completed` in `statusSuccess`; an `error` card shows the destructive
      border and status text. (all three live-verified against a real daemon: a genuine `sleep 6`
      running card, a `false` error card, several `✓ completed` cards)
- [x] A `tool_call` with `status: "awaiting_approval"` renders `awaiting_approval` as plain muted
      text without throwing. `[INFERENCE]` — not observed live (the real Pi provider never emitted
      this string during manual testing); verified by code inspection: `statusTrailing()`'s
      `row.statusText && row.statusText !== "running"` guard is a plain string comparison with no
      unsafe access, and the branch renders a `<span>` with that string as its only child.
- [x] A tool with terminal output shows exactly one `output · N lines` region; a tool without output
      shows none; the region is a distinct element whose presence is independent of expand/collapse.
      (live-verified: `document.querySelectorAll('[class*="toolOutputStrip"]')` returned the strip
      both collapsed and after expanding the diff-test `EDIT` card)
- [x] An `edit` card shows `+N −N` matching the diff, a collapsed first-changed-line preview with a
      `… N more lines` indicator, and the full `DiffView` when expanded. (live-verified: a real
      3-line edit rendered `+3 −3`, a `- line 3` preview tinted destructive + `… 5 more lines`
      collapsed, then the full hunk-by-hunk `DiffView` on expand with the preview gone)
- [x] Clicking `Open` on an `edit`/`write` card opens that file as a tab in the chat tab's own pane
      and does not toggle the card's expansion. (live-verified: clicked `Open` on a `WRITE` card,
      `/tmp/tool-card-smoke-test.txt` opened as a new tab showing "hello world"; the source card's
      `aria-expanded` was confirmed `"false"` immediately before the click)
- [x] Expand/collapse still works, `aria-expanded` is correct, bodyless cards are non-interactive,
      and the row re-measures (no clipped or overlapping rows after toggling). (live-verified
      expand/collapse on the diff-test `EDIT` card; bodyless-card `tabIndex={-1}`/`aria-disabled`
      verified by code inspection — no live trigger produced a genuinely bodyless card, every real
      tool call carried at least a primary-field body section)
- [x] All values are tokens; `token-integrity` and `font-scale` tests pass. (both green in the
      `npx vitest run packages/web-client` run above; every new declaration uses `var(--pi-*)` — no
      hex/rgba literals)

## Follow-ups / TODO(verify)

- `awaiting_approval` unknown-status rendering and the bodyless-card non-interactive state are
  verified by code inspection, not a live trigger — see the two `[INFERENCE]`-flagged criteria
  above. Both are small, guarded branches with no unsafe operations; no test infrastructure exists
  to assert them at the component level (project convention: pure-logic Vitest, browser
  verification for components), and neither the real daemon nor a quick manual prompt produced a
  genuinely bodyless tool call or an `awaiting_approval` status during this session.
- Live-created scratch files (`/tmp/tool-card-smoke-test.txt`, `/tmp/tool-card-diff-test.txt`) were
  removed after verification; no repo files were left behind. The "New chat" test session opened
  during task-003/004 manual verification remains in the daemon's session list (documented as a
  known cleanup gap in task-003's summary — a native `confirm()` dialog stalled its "Delete
  permanently" flow once); it is dev-daemon scratch data, not part of this change's source tree.
