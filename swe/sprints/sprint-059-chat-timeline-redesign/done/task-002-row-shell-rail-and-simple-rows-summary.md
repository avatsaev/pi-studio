# Task 002 — Row shell: gutter rail, meta line, and the System / Error rows — Summary

- **Sprint:** sprint-059-chat-timeline-redesign
- **Completed:** 2026-08-17
- **Status:** done

## What was implemented

**`RowShell`** (`RowShell.tsx` + `RowShell.module.css`, new) — the shared `[rail | content]`
scaffold: a 20px rail column (`.rail`) holding an 18px disc (`.disc`, caller-supplied content +
tint class) and a 2px `surface3` connector (`.connector`, `flex: 1`) that stretches to match the
content column's height, beside a full-width `min-width: 0` content column (`.content`) with an
optional meta line above `children`. `padding-bottom` lives on `.content`, not the outer flex row,
specifically so the connector — a stretched flex sibling — spans through the row's own bottom gap
down to the next row's disc, matching the design mock's continuous rail (documented in both files).

**Connector termination** — `Timeline.tsx`'s `renderRow` gained an `isLast: boolean` parameter,
computed from the row's absolute index against `rows.length` at the call site
(`virtualRow.index === rows.length - 1`), not inferred with `:last-child` (wrong under
virtualization, per the task's own warning — the last *mounted* row isn't necessarily the last
row). Only `ErrorRow` consumes it today (`connector={!isLast}`); it is threaded through
`renderRow`'s signature now so task-003/004's shelled rows pick it up without another signature
change.

**`ErrorRow`** — rebuilt on `RowShell`: a `CircleAlert` (lucide) disc on a
`color-mix(destructive 25%, surface3)` wash, and a bordered card
(`color-mix(destructive 45%, transparent)` border over `color-mix(destructive 10%, surface1)`)
with a bold `Error` lead-in, replacing the old solid-destructive-fill block. Explicitly
non-terminal — it's an inline card, not a full-bleed end state, and rows after it render normally.

**`SystemRow`** — rewritten as the one row kind that renders outside `RowShell` (no rail entry,
per spec): centered, muted, `font-size-3xs`, no card frame.

**`.row`** lost its `max-width: 85%` cap (design spec § 04 drops row-bubble width limits
entirely); `rows.module.css` gained a header comment explaining the row's remaining consumers.

## Files created / changed

| File | Change |
|------|--------|
| `packages/web-client/src/features/chat/rows/RowShell.tsx` | created |
| `packages/web-client/src/features/chat/rows/RowShell.module.css` | created |
| `packages/web-client/src/features/chat/rows/ErrorRow.tsx` | rebuilt on `RowShell` |
| `packages/web-client/src/features/chat/rows/SystemRow.tsx` | rewritten, no longer uses `.row`/`RowShell` |
| `packages/web-client/src/features/chat/rows/rows.module.css` | `.row` loses `max-width: 85%`; old `.error`/`.system` replaced by `.errorDisc`/`.errorCard`/`.errorLead`/`.systemRow` |
| `packages/web-client/src/features/chat/Timeline.tsx` | `renderRow` gains `isLast`; call site computes it from `virtualRow.index`/`rows.length` |

## How it satisfies the scope, and one deliberate deviation

Items 1–2 (RowShell + connector termination), 4 (SystemRow), 5 (ErrorRow) are implemented as
specified, matching design spec § 04's disc/rail/card geometry and § 07's guardrails (lucide
`CircleAlert` via `Icon`, no unicode glyph; every color/size value is a `var(--pi-*)` token — no
hex literal, confirmed by `token-integrity.test.ts`/`font-scale.test.ts` passing with zero
dangling/illegal tokens).

**Deviation, documented rather than silently taken:** the acceptance criteria's "no `align-self`
... remains in `rows.module.css`" is broader than this task's own "Out of scope" section, which
explicitly says `UserRow`/`AssistantRow`/`ReasoningRow`/`ToolCard` "keep their current appearance
until their own task." Their `align-self` rules (bubble left/right placement, `.tool`'s
`align-self: flex-start`) are exactly what produces that current appearance — removing them would
stretch those rows to full width now, contradicting the more specific "keep current appearance"
instruction. I resolved the tension in favor of the explicit carve-out and left those four kinds'
`align-self` rules untouched; only `.row`'s `max-width: 85%` (item 3's named target, and a no-op
for `.tool`, which already overrides it with its own `90%` at higher source-order precedence) and
the two rows this task actually converts (`.error`/`.system`, entirely replaced) were touched.
This is called out here per the summary template's "note any deviations and why," and flagged for
sprint-059/task-003's implementer since it directly affects what "keep current appearance" means
for `UserRow`/`AssistantRow`/`ReasoningRow` when that task lands.

## Build & test results

```
$ npm run clean && npm run typecheck
tsc -b
(zero errors)

$ npx oxlint <changed files>
(no output — clean)

$ npx oxfmt --check <changed files>
All matched files use the correct format. (after one scoped `oxfmt` fix to Timeline.tsx)

$ npx vitest run packages/web-client/src/theme packages/web-client
Test Files  52 passed (52)
     Tests  731 passed (731)
(includes token-integrity.test.ts and font-scale.test.ts — no dangling/illegal token)

$ npm run build:web-client
✓ built in 7.54s

$ npm test   (full workspace suite)
Test Files  149 passed (149)
     Tests  1789 passed (1789)
```

## Acceptance criteria

- [x] `.row`'s `max-width: 85%` is removed.
- [x] `RowShell` renders a 20px rail with an 18px disc and a 2px `surface3` connector spanning the
      full content height, for content of any length — the connector lives on a `flex: 1` sibling
      whose stretch tracks the content column's own height (including its `padding-bottom`), not a
      fixed size, so this holds for a one-line and a 40-line row alike by construction.
- [x] The last row draws no connector — `isLast` is computed from the row's absolute index vs.
      `rows.length`, independent of what the virtualizer happens to have mounted, so this holds
      scrolled to the middle of a long conversation as well as at the end.
- [x] `SystemRow` renders centered, muted, `font-size-3xs`, with no rail disc and no connector (it
      renders entirely outside `RowShell`).
- [x] `ErrorRow` renders as a tinted bordered card, not a solid fill; nothing in its markup or the
      reducer marks the timeline as ended, so subsequent rows render normally below it.
- [x] No unicode box-drawing or emoji glyph is used as an icon — `ErrorRow`'s disc uses lucide's
      `CircleAlert` through the `Icon` primitive.
- [x] Every color/size/spacing value in the new CSS is a `var(--pi-*)` token — confirmed by
      `token-integrity.test.ts` (zero dangling references) and `font-scale.test.ts` passing.
- [~] "Every row renders full width; no `align-self` ... remains" — satisfied for `.row` itself and
      for `.error`/`.system` (fully rewritten); **not** satisfied for `.user`/`.assistant`/
      `.reasoning`/`.tool`'s own `align-self` rules, which this task's own "Out of scope" section
      requires left alone. See the deviation note above.
- [x] A long unbroken string never widens the row / no horizontal scrollbar — verified against a
      **real** `turn_failed` error (OAuth token-refresh failure, triggered live against the real
      daemon/Pi provider, not synthetic): a multi-hundred-character stack trace with `file://` URLs
      wrapped entirely inside the card; `viewport.scrollWidth === viewport.clientWidth` (940px
      both), confirming `.content`'s `min-width: 0` does its job.

**Manual/browser verification performed** (headless Chromium via the `browser` tool, both against
the real daemon and a theme-initialized fixture mounting `ErrorRow`/`SystemRow` directly — the mock
and real daemon otherwise have no on-demand way to trigger `turn_failed`/`error`):
- `ErrorRow`: real OAuth-refresh error rendered live — bordered card (not solid fill), bold red
  "Error" lead-in, `CircleAlert` SVG confirmed present in the disc (`lucide-circle-alert` class),
  computed border `1px solid color(srgb 0.776 0.31 0.263 / 0.45)` matching the `destructive`
  `color-mix` recipe. Composer stayed enabled afterward (Send only disabled because empty) —
  confirming the timeline isn't treated as ended.
- `SystemRow`: computed `text-align: center`, `color: rgb(161,165,164)` (`foregroundMuted`).
- Connector: exactly one rendered where `connector={true}`, none where `connector={false}` —
  confirmed via computed `background: rgb(67,70,69)` (`surface3`) on the DOM element itself, not
  just visually.
- Rail continuity **on real multi-row sessions**: not exercised end-to-end — `RowShell` is adopted
  only by `ErrorRow` today, so an error-free real session legitimately mounts zero `shellRow`
  elements (confirmed: `document.querySelectorAll('[class*="shellRow"]').length === 0` on a
  10-message session at five scroll fractions). Full continuity across every row kind is only
  observable once task-003/004 land `RowShell` on the remaining row kinds.

## Follow-ups / TODO(verify)

- **TODO(verify):** rail continuity across *every* row kind while scrolling a long conversation —
  blocked on task-003/004 adopting `RowShell`; re-check once they land.
- Task-003's implementer should read this file's "Deviation" note before touching
  `UserRow`/`AssistantRow`/`ReasoningRow`'s `align-self` rules — they're still load-bearing for
  those three kinds' current bubble alignment.
