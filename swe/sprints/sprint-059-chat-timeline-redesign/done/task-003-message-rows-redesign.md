# Task 003 — User, Assistant and Reasoning rows on the new shell

- **Sprint:** sprint-059-chat-timeline-redesign
- **Status:** done
- **Type:** feature
- **Area:** packages/web-client (chat timeline)
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** task-002

## Goal

Move the three prose rows onto `RowShell` with their redesigned treatments: the user's accent-tinted
inline bubble, the assistant's bubble-less body with a block streaming caret, and the reasoning row's
italic muted body with a `final` chip.

## Context / why

Per § 04 these three rows diverge sharply:

- **User** keeps a bubble, but a *shrink-to-fit* one — `display: inline-block` so a three-word prompt
  renders a three-word bubble instead of today's `max-width: 85%` block.
- **Assistant** loses its bubble entirely (`rows.module.css:88-99`): plain body text on the timeline
  background, identified only by its rail disc and meta line.
- **Reasoning** loses its card (`:119-127`): italic `foregroundMuted` body, plus a small `final` chip
  in the meta line once the block closes.

The streaming caret also changes medium: today it is the character `▍` blinking via
`@keyframes blink` (`:101-117`). The redesign specifies a 7×14 solid `accentBright` block — a styled
element, not a glyph, per § 07's no-glyph rule.

`AssistantRow`/`ReasoningRow`'s streaming→markdown switch is **behavior, not styling**: the reducer
clears `streaming` at block close (`assistant_message.final`) and the component swaps plain text for
`<Markdown>` at that moment. That contract is unchanged here — only the caret's rendering and the
surrounding chrome change.

## Scope references

- `swe/design/redesign 0.1.0/Redesign Handoff Spec.dc.html` § 04 (user / reasoning / assistant row
  specs and the reference mock markup), § 02 (token mapping), § 07 (guardrails)
- `swe/features/timeline-rendering.md` § Row treatments, § Markdown feature support
- `packages/web-client/src/features/chat/rows/UserRow.tsx` — pending / failed / queued states, images, `Dialog`
- `packages/web-client/src/features/chat/rows/AssistantRow.tsx` — streaming vs `<Markdown>` switch
- `packages/web-client/src/features/chat/rows/ReasoningRow.tsx`
- `packages/web-client/src/features/chat/rows/rows.module.css:38-127`
- `packages/web-client/src/timeline/row-model.ts:11-68` — `UserRow.pending/failed/queued`, `streaming`
- `packages/web-client/src/theme/colors.ts:226,242,289` — `accentForeground` per variant
- Modify: `UserRow.tsx`, `AssistantRow.tsx`, `ReasoningRow.tsx`, `rows.module.css`

## What to build

**1. `UserRow`.** Rail disc tinted `accent`. Meta line `You`. Body is an `inline-block` bubble:
`color-mix(accent 20%, surface1)` fill, `color-mix(accent 45%, transparent)` border, `radius-lg`.

Preserve all three existing state semantics, restyled rather than dropped:

- `pending` — dimmed (optimistic echo awaiting the server's `user_message` broadcast).
- `failed` — must stop being a **solid** `destructive` fill (`rows.module.css:55-59`); becomes a
  destructive-tinted variant of the same bubble, keeping the "failed to send" label.
- `queued` — keeps its badge; it may move into the meta line as a chip alongside the label.

Image thumbnails and the full-size `Dialog` are unchanged behavior; only their position relative to
the bubble may shift.

**2. `AssistantRow`.** Rail disc tinted `accent`. Meta line `Assistant`. No bubble, no background, no
`border-left` streaming indicator (`:97-99`) — the caret is the streaming signal now.

**3. `ReasoningRow`.** Rail disc muted. Meta line `Reasoning` plus a small bordered `final` chip
rendered when the block has closed (i.e. `!row.streaming`). Body: italic `foregroundMuted` at
`font-size-2xs`, no card, no background.

**4. Shared streaming caret.** One caret element used by both streaming rows: ~7×14, solid
`accentBright`, inline at the end of the text. Replaces the `▍` glyph and the `blink` keyframes.
Honour `prefers-reduced-motion: reduce` — hold it static rather than animating (§ 05 sets this
expectation for the progress bar; apply the same rule to every animation this sprint introduces).

**5. Accent-foreground correctness.** Any text or icon sitting on an `accent` fill uses
`--pi-color-accentForeground`, never a hardcoded white. The `zinc` variant's accent is near-white
(`colors.ts:289` derives `accentForeground` via `contrastForeground`), so a hardcoded white disc
glyph is invisible there. § 07 calls this out explicitly.

## Out of scope

- `ToolCard` (task 004), `SystemRow`/`ErrorRow` (task 002, already done).
- Any reducer or row-model change — `streaming`, `pending`, `failed`, `queued` semantics are read
  here, never redefined.
- Markdown rendering internals, file links, inline images — untouched.
- Timestamps in the meta line (deferred by sprint decision).
- Composer-side queue chips (a later redesign sprint) — this task only keeps the existing per-row
  `queued` affordance working.

## Acceptance criteria

- [ ] A short user prompt renders a bubble that hugs its text; a long one wraps within the content
      column without overflowing it.
- [ ] `pending`, `failed` and `queued` user rows remain visually distinct from a normal row and from
      each other; `failed` still shows "failed to send" and is a tint, not a solid destructive fill.
- [ ] User image thumbnails still render and still open full-size in the `Dialog`.
- [ ] The assistant row has no bubble, no background fill, and no left border in either streaming or
      finalized state.
- [ ] A streaming assistant row shows the block caret; the caret disappears the moment `streaming`
      clears and the body switches to rendered markdown — mid-turn, not at turn end.
- [ ] The reasoning row is italic and muted, and shows the `final` chip only after its block closes.
- [ ] No `▍` (or any glyph) is used for the caret; no `blink` keyframe remains.
- [ ] Under `prefers-reduced-motion: reduce` no caret animation runs.
- [ ] In the `zinc` variant, disc glyphs/text on accent fills stay legible (uses `accentForeground`).
- [ ] All new CSS values are tokens; `token-integrity` and `font-scale` tests pass.

## Test / verification plan

- Build: `npm run build:web-client` succeeds.
- Typecheck: `npm run typecheck` succeeds.
- Lint/format: `npx oxlint <changed files>`, `npx oxfmt --check <changed files>` clean.
- Tests: `npx vitest run packages/web-client` — no regression; theme tests green.
- Manual: `npm run dev:daemon` + web client. Send a short prompt and a long one; watch a streaming
  reply flip to markdown mid-turn; trigger a send failure (stop the daemon mid-send) for the
  `failed` state; steer a running turn for `queued`; attach an image and open it. Repeat the caret
  and accent checks in the `zinc` and `light` variants, and once with reduced motion enabled in the
  OS/browser.

## Notes

- The mock's `Y` / `π` disc letters are illustrative. Use lucide icons via `Icon` (or `Avatar` where
  a real identity exists) — § 07 forbids shipping glyph stand-ins.
- Do not "fix" the streaming→markdown switch to wait for `turn_completed`; switching at block close
  is a deliberate, documented behavior (`AssistantRow.tsx:1-7`, `row-model.ts:53-59`).
- The `light` variant must be eyeballed specifically: the `color-mix` fills darken there rather than
  lighten, and a mix tuned only on dark can read as a muddy grey (§ 07 verification list).
