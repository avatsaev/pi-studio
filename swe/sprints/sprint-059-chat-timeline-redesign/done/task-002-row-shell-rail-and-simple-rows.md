# Task 002 — Row shell: gutter rail, meta line, and the System / Error rows

- **Sprint:** sprint-059-chat-timeline-redesign
- **Status:** done
- **Type:** feature
- **Area:** packages/web-client (chat timeline)
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** none

## Goal

Replace the chat-bubble row layout with the redesign's gutter-rail structure — a 20px rail column
holding an 18px icon/avatar disc and a connector line, beside a full-width content column with a
meta line — and convert the two simplest consumers (`SystemRow`, `ErrorRow`) to prove the shell.

## Context / why

Today every row is a self-aligned bubble: `.row` is `max-width: 85%` and each kind sets
`align-self: flex-start|flex-end` with its own background and notched corner
(`rows.module.css:3-11,38-45,88-99`). The redesign (§ 04) drops that entirely — rows are full width,
visually threaded by a continuous rail, and the sender identity moves from an uppercase `.who` label
into a meta line (`You · 09:41:12`, `Reasoning · …`, `Assistant · …`).

This task lands the shared structure once so tasks 003 and 004 are pure per-row restyles rather than
three parallel re-inventions of the same scaffold.

Two structural facts to respect:

- `Timeline.tsx:152-160` wraps each virtual row in `.rowWrap` (`position:absolute`,
  `display:flex; flex-direction:column`) measured by `virtualizer.measureElement`. The rail lives
  *inside* the row component, so the virtualizer needs no change — but `.rowWrap`'s
  `flex-direction: column` must not fight the shell's `[rail | content]` row axis.
- The connector must not dangle below the final row. The mock's last row has a disc and no line.

## Scope references

- `swe/design/redesign 0.1.0/Redesign Handoff Spec.dc.html` § 04 (rail, discs, meta line, error and
  system row treatments), § 02 (token mapping), § 07 (DO NOT: no unicode/emoji glyph icons — use
  `Icon` + lucide; don't hand-roll a spinner/dot/badge)
- `swe/features/timeline-rendering.md` § Row kinds, § Row treatments, § Turn grouping, spacing & footers
- `swe/architecture/design-system.md`
- `packages/web-client/src/features/chat/Timeline.tsx:34-61` (`renderRow`), `:145-176` (virtual row wrapper)
- `packages/web-client/src/features/chat/Timeline.module.css:15-23` (`.rowWrap`)
- `packages/web-client/src/features/chat/rows/rows.module.css` — the bubble styles being replaced
- `packages/web-client/src/features/chat/rows/SystemRow.tsx`, `ErrorRow.tsx`
- `packages/web-client/src/components/primitives/Icon.tsx`, `Avatar.tsx` (`size` prop), `index.ts`
- Create: a `RowShell` component + its styles under `features/chat/rows/`
- Modify: `Timeline.tsx`, `rows.module.css`, `SystemRow.tsx`, `ErrorRow.tsx`, `Timeline.module.css` (if needed)

## What to build

**1. `RowShell`** — the shared `[rail | content]` scaffold every non-system row renders through.

- Props: the rail visual (a lucide icon or an avatar-style disc, plus its tint), an optional meta
  line (label + optional trailing chip slot), whether to draw the connector, and children.
- Rail column: fixed 20px, `flex: none`. Disc: 18px, `radius-full`, centered icon at ~10px.
  Connector: `flex: 1`, 2px wide, `surface3`, directly under the disc — so it stretches to whatever
  height the content column takes.
- Content column: `flex: 1; min-width: 0` (mandatory — without `min-width: 0` a long unbroken path
  or code line blows out the flex row instead of ellipsing), meta line above children.
- Icons come from lucide through the `Icon` primitive. No `▶`/`◐`/`▤`/`>_`/`±` literals: those are
  the mock's stand-ins, and § 07 forbids shipping them.

**2. Connector termination.** `renderRow` learns the row's position so the last row draws a disc
without a trailing line. Pass it explicitly from `Timeline.tsx`'s map (the index and `rows.length`
are both already in hand at `:148-151`) — do not infer it in CSS with `:last-child`, which is wrong
under virtualization: the last *mounted* element is not the last row.

**3. Row geometry.** `.row` loses `max-width: 85%` and the `align-self` rules; rows become full
width with vertical rhythm from the shell's bottom padding. The `.who` uppercase label is replaced
by the meta line — muted, `font-size-3xs`, sitting above the content.

**4. `SystemRow`** — per § 04 a centered muted marker at `font-size-3xs`, spanning the full width
with **no rail entry** (it is the one row kind that does not render through `RowShell`).

**5. `ErrorRow`** — inline card, not a solid fill: `color-mix(destructive 45%, transparent)` border
over `color-mix(destructive 10%, surface1)`, bold `Error` lead-in then the message. Rail disc uses
the destructive tint. It is explicitly **non-terminal** — the timeline continues below it — so it
must not stretch, center, or otherwise read as an end-state.

## Out of scope

- `UserRow`, `AssistantRow`, `ReasoningRow` (task 003) and `ToolCard` (task 004) — they keep their
  current appearance until their own task; they may render unshelled in the interim as long as the
  build is green and the timeline is usable.
- Removing the `working`-dots running indicator in `Timeline.module.css:34-75` — it stays until the
  TurnProgressBar sprint replaces it (deliberate: do not leave a gap with no running affordance).
- Timestamps in the meta line (deferred by sprint decision; the meta line renders label-only).
- Any change to the virtualizer, autoscroll, or `measureElement` behavior.

## Acceptance criteria

- [ ] Every row renders full width; no `align-self` or `max-width: 85%` remains in `rows.module.css`.
- [ ] `RowShell` renders a 20px rail with an 18px disc and a 2px `surface3` connector that spans the
      full height of the content beside it, for both a one-line and a 40-line row.
- [ ] The last row in the timeline draws no connector; every earlier row does — verified while
      scrolled to the middle of a long virtualized conversation, not just at the end.
- [ ] A row containing a 200-character unbroken path ellipses or wraps within the content column and
      never widens the row or introduces a horizontal scrollbar.
- [ ] `SystemRow` renders centered, muted, `font-size-3xs`, with no rail disc and no connector.
- [ ] `ErrorRow` renders as a tinted bordered card (not a solid destructive fill), and rows after it
      continue rendering normally below.
- [ ] No unicode box-drawing or emoji glyph is used as an icon anywhere in the new markup.
- [ ] Every color/size/spacing value in the new CSS is a `var(--pi-*)` token — no hex literal, no raw
      `px` font size.

## Test / verification plan

- Build: `npm run build:web-client` succeeds.
- Typecheck: `npm run typecheck` succeeds.
- Lint/format: `npx oxlint <changed files>`, `npx oxfmt --check <changed files>` clean.
- Tests: `npx vitest run packages/web-client/src/theme` — `token-integrity.test.ts` and
  `font-scale.test.ts` must pass (they are the guard against a dangling token or a raw px font size).
  Full `npx vitest run packages/web-client` to confirm no regression.
- Manual: `npm run dev:daemon` + web client; open a session with existing history (mock provider is
  enough) and confirm rail continuity while scrolling a long conversation, a canceled-turn system
  marker, and an error row followed by further rows.

## Notes

- `.rowWrap`'s `padding-bottom` (`Timeline.module.css:22`) plus the shell's own bottom padding
  determine the visible gap in the connector between rows. Tune once, in one place; the mock shows a
  continuous thread, so keep the gap small or zero.
- Height changes re-measure through `virtualizer.measureElement` automatically — no manual
  invalidation needed, same as the existing expand/collapse path.
- `Avatar` takes `projectKey`/`src`/`size`; for the user/assistant discs a plain tinted disc with a
  lucide icon may be simpler than bending `Avatar` to a non-project identity. Either is acceptable —
  do not add a second avatar implementation if `Avatar` fits.
