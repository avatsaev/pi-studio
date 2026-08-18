# Task 004 — ToolCard rebuild: kind badge, status treatment, output strip, diff preview

- **Sprint:** sprint-059-chat-timeline-redesign
- **Status:** done
- **Type:** feature
- **Area:** packages/web-client (chat timeline)
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** task-001, task-002

## Goal

Rebuild the tool-call card to the redesigned structure — a kind badge + full primary field + status
in the header, a `surface0` output strip, an inline diff preview with `+N −N` counts and an open-file
affordance for `edit`/`write` — driven by the tinted-token recipe so one token colors each badge.

## Context / why

Today's card is `[chevron] [icon] Label inlineDetail [StatusBadge]` with a collapsed body
(`ToolCard.tsx:42-86`). The redesign (§ 04) restructures the header around a **kind badge** and the
tool's full primary field, and moves status from a badge component to inline colored text — because
status is a free-form wire string that must degrade to plain muted text for unknown values, which a
fixed-variant `StatusBadge` cannot express.

Two correctness points, both from § 07's DO-NOT list:

- **One token, three ratios.** A badge's text, background and border all derive from a single token
  (`--kindToken`) via `color-mix` at 100% / 20% / 48%. Splitting them across token families is
  explicitly forbidden — it is what makes the badges read as one family across all six variants.
- **`statusSuccess`, never `success`.** On dark variants `success` aliases the accent
  (`theme/colors.ts:246`), so a `success`-colored WRITE badge would be indistinguishable from READ.

The existing expand/collapse interaction and `<DiffView>` reuse are good and stay; the chrome around
them is what changes.

## Scope references

- `swe/design/redesign 0.1.0/Redesign Handoff Spec.dc.html` § 04 (tool card mock, badge-per-kind
  table, status-treatment table, and the `ToolCard.module.css` tinted-token recipe), § 02, § 07
- `swe/features/timeline-rendering.md` § Tool-call cards, § Diff rows
- `packages/web-client/src/features/chat/rows/ToolCard.tsx` — rebuild
- `packages/web-client/src/features/chat/rows/rows.module.css:129-228` — tool styles
- `packages/web-client/src/timeline/tool-mapping.ts` — task-001's badge/diff-stat/output helpers, plus
  existing `toolBody`, `toolIcon`
- `packages/web-client/src/timeline/row-model.ts:70-77` — `ToolRow`, incl. task-001's `statusText`
- `packages/web-client/src/features/files/DiffView.tsx` — reused as-is for the expanded diff
- `packages/web-client/src/timeline/file-open-target.ts` — `resolveFileOpenTarget(assetBase, owningPaneId, workspaceCwd)`
- `packages/web-client/src/features/files/open-file-tab.ts` — `openFileTab(path, workspaceCwd, targetPaneId)`
- `packages/web-client/src/timeline/FileLink.tsx:29-51` — the established click-to-open dispatch to copy
- `packages/web-client/src/features/chat/Timeline.tsx:34-61` — `renderRow` (must thread new props)
- Modify: `ToolCard.tsx`, `rows.module.css`, `Timeline.tsx`

## What to build

**1. Header.** `[KIND BADGE] [primary field] [trailing status area]`, rendered inside `RowShell`
whose rail disc carries the tool's lucide icon.

- Badge: task-001's label + tint token, applied through a `--kindToken` custom property set on the
  element so one CSS rule serves all seven kinds. `font-size-4xs`, bold, `radius-base`.
- Primary field: the tool's **full** `path`/`command`/`query`/`url`/`description`, monospace,
  `flex: 1; min-width: 0`, single line with ellipsis. Full value in `title` for hover inspection.
- Trailing: per-status treatment (below), plus for `edit` the `+N −N` counts from task-001's diff
  stats — `added` in `statusSuccess`, `removed` in `destructive`.

**2. Status treatment** (§ 04's table), keyed off the normalized `row.status`:

- `running` — card border `color-mix(accent 45%, transparent)`, header wash
  `color-mix(accent 10%, transparent)`, `Spinner` primitive + the status word. Do not hand-roll a
  spinner (§ 07).
- `completed` — `✓ completed` in `statusSuccess`.
- `error` — border `color-mix(destructive 45%, transparent)`, status text in `destructive`.
- Unknown/other — when `statusText` is present but not one of the recognized words, render it as
  plain muted text. Never crash, never fall through to an empty header.

**3. Output region.** One region below the header, `surface0` background, top border
`color-mix(border 60%, transparent)`, monospace `font-size-3xs` muted. With terminal output present
it reads `output · N lines` from task-001's helper. Absent/empty output → no region at all.

Build it as a **distinct element with its own class**, not a pseudo-element or a border on the
header, because it is also the designated home for *in-flight* output: `sprint-058/task-005` renders
a capped live tail there while a tool is `running`. That task owns the tail's behavior (helper,
cap, bounded height); this task owns the slot and its visual language, so the behavior task inherits
a designed region instead of inventing one in the new idiom. Concretely, reserve the region's
running-state treatment now — same `surface0` block, sitting under the accent-washed header — and do
not couple its presence to the expanded/collapsed state, since the tail must show while collapsed.

**4. Diff preview for `edit`.** Collapsed, the card shows the first changed line plus
`… N more lines`, tinted `color-mix(statusSuccess 9%, transparent)` for additions. Expanding still
renders the full `<DiffView>` — reuse it, do not reimplement diff rendering.

**5. Open-file affordance.** For `edit`/`write` (a tool with a real `path`), an `Open` control in the
header dispatching `openFileTab(path, target.workspaceCwd, target.targetPaneId)` with `target` from
`resolveFileOpenTarget(...)` — the exact dispatch `FileLink` already uses, so the file opens in the
chat tab's own pane. This requires `renderRow` to thread `assetBase` / `owningPaneId` /
`workspaceCwd` into `ToolCard` (today it passes them only to the assistant and reasoning rows,
`Timeline.tsx:42-59`). The control must not trigger the header's expand/collapse — stop propagation,
and keep it a real button/anchor, not a nested interactive element inside the header button.

**6. Expand/collapse.** Preserved: header click toggles, `aria-expanded` stays correct, cards with no
expandable body are not interactive. The virtualizer re-measures on toggle via `measureElement` — no
special handling.

## Out of scope

- Live output *tailing* behavior while `running` (the tail helper, its cap, its bounded scroll) —
  that is `sprint-058/task-005`. This task ships the region that tail renders into, per "What to
  build" § 3, and stops there.
- Adding a `"canceled"` status (also sprint-058).
- Changing `toolBody`'s section model or `DiffView` internals.
- Permission prompts, plan cards, or any row kind that does not exist in `TimelineRow` (§ 04:
  "Don't invent timeline rows").
- Batching multiple tool calls into one card — § 04 requires one card per call, which is already the
  reducer's behavior (`onToolCall` upserts by `callId`).

## Acceptance criteria

- [ ] Each of the seven kinds renders its documented badge label and tint; an unknown kind renders
      the `task` fallback treatment.
- [ ] A badge's text, background and border all derive from one `--kindToken`; no badge mixes token
      families, and no badge uses `success`.
- [ ] The header shows the **full** path/command (ellipsed by CSS, full text in `title`) — not a
      basename or truncated first line.
- [ ] A `running` card shows the accent border + header wash and the `Spinner` primitive; a
      `completed` card shows `✓ completed` in `statusSuccess`; an `error` card shows the destructive
      border and status text.
- [ ] A `tool_call` with `status: "awaiting_approval"` renders `awaiting_approval` as plain muted
      text without throwing (this is what task-001's `statusText` exists for).
- [ ] A tool with terminal output shows exactly one `output · N lines` region; a tool without output
      shows none; the region is a distinct element whose presence is independent of expand/collapse.
- [ ] An `edit` card shows `+N −N` matching the diff, a collapsed first-changed-line preview with a
      `… N more lines` indicator, and the full `DiffView` when expanded.
- [ ] Clicking `Open` on an `edit`/`write` card opens that file as a tab in the chat tab's own pane
      and does **not** toggle the card's expansion.
- [ ] Expand/collapse still works, `aria-expanded` is correct, bodyless cards are non-interactive,
      and the row re-measures (no clipped or overlapping rows after toggling).
- [ ] All values are tokens; `token-integrity` and `font-scale` tests pass.

## Test / verification plan

- Build: `npm run build:web-client` succeeds.
- Typecheck: `npm run typecheck` succeeds.
- Lint/format: `npx oxlint <changed files>`, `npx oxfmt --check <changed files>` clean.
- Tests: `npx vitest run packages/web-client` (task-001's mapping tests cover the badge/stat logic;
  no component-test infrastructure is added — project convention).
- Manual: `npm run dev:daemon` + web client, then a real Pi session exercising each kind — a `shell`
  command (watch `running` → `completed`), a `read`, an `edit` (counts, preview, expand, `Open`), a
  failing tool for the `error` treatment, and a long path/command for ellipsis. Check `dark`,
  `light` and `zinc`.

## Notes

- **Sprint-058 seam.** `sprint-058/task-005` (planned, unstarted) adds a live output tail to this
  card, a `"canceled"` status, and terminal-output authority. Keep two things easy for it: the
  output strip must be a **distinct element** below the header (so a tail block can slot in beside
  it), and the status treatment must be a lookup keyed by status (so adding `"canceled"` is one
  entry, not a new branch). Whichever sprint lands second reconciles `ToolCard.tsx` by hand — the
  changes are complementary, not contradictory.
- `StatusBadge` is no longer the right primitive for tool status (fixed variants can't express a
  free-form string), but do **not** delete it — it has other consumers. Just stop using it here.
- The `Spinner` primitive takes `size`/`color`; pass `accentBright` rather than restyling it.
- Reduced motion: the running spinner must respect `prefers-reduced-motion` like every other
  animation this sprint touches.
