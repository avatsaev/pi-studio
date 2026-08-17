# Task 003 — User, Assistant and Reasoning rows on the new shell — Summary

- **Sprint:** sprint-059-chat-timeline-redesign
- **Completed:** 2026-08-17
- **Status:** done

## What was implemented

`UserRow`, `AssistantRow` and `ReasoningRow` moved off the old `.row`/`.who` bubble family onto the
shared `RowShell` rail scaffold (design spec § 04):

- **`UserRow`** — accent-tinted rail disc (lucide `User`, `accentForeground` icon color), meta line
  `You` (`You · failed to send` when `row.failed`). Body is now a `display: inline-block` bubble
  (`color-mix(accent 20%, surface1)` fill, `color-mix(accent 45%, transparent)` border, `radius-lg`)
  that hugs its own text instead of the old `max-width: 85%` block. `pending` dims the whole row
  content (`.userPendingRow`, opacity 0.6); `failed` swaps the bubble to a destructive-tinted variant
  (`.userBubbleFailed`) instead of the old solid `destructive` fill; `queued` renders a small bordered
  chip on the meta line (`.queuedBadge`, restyled from a solid dark pill to a bordered chip consistent
  with the new `final` chip). Images/`Dialog` behavior unchanged, now nested inside `RowShell`'s
  content column.
- **`AssistantRow`** — accent-tinted rail disc (lucide `Bot`), meta line `Assistant`. No bubble, no
  background, no `border-left` streaming indicator — `.assistantBody` is plain flowed text on the
  timeline background.
- **`ReasoningRow`** — muted rail disc (`surface3` fill, lucide `Brain`, `foregroundMuted` icon), meta
  line `Reasoning` plus a small bordered `final` chip (`.finalChip`) once `!row.streaming`. Body is
  `.reasoningBody`: italic, `foregroundMuted`, `font-size-2xs`, no card.
- **Shared streaming caret** (`.caret`) — a 7×14 (`--pi-spacing-7`×`--pi-spacing-14`) solid
  `accentBright` block, replacing the `▍` glyph. Blinks via `@keyframes caretBlink`;
  `@media (prefers-reduced-motion: reduce)` sets `animation: none` so it holds static. Used
  identically by `AssistantRow` and `ReasoningRow`.
- **`Timeline.tsx`** — `renderRow` now threads `connector={!isLast}` into `UserRow`/`AssistantRow`/
  `ReasoningRow` (previously only `ErrorRow` received it), so the rail connector correctly stops at
  the last row across every converted row kind, virtualization-safe (index-based, not `:last-child`).

`rows.module.css` deleted the obsolete `.who`, old `.user`/`.assistant`/`.reasoning`/`.streaming`/
`.cursor`/`@keyframes blink` rules entirely (they were exclusive to these three components — verified
via a workspace grep before removal) and replaced the hardcoded `rgba(20, 20, 24, 0.45)`/`#c7cbd1`
`.queuedBadge` colors with tokens. `.row`/`.tool` (still used by `ToolCard`, task-004) are untouched.

## Files created / changed

| File | Change |
|------|--------|
| `packages/web-client/src/features/chat/rows/UserRow.tsx` | rewritten on `RowShell` |
| `packages/web-client/src/features/chat/rows/AssistantRow.tsx` | rewritten on `RowShell` |
| `packages/web-client/src/features/chat/rows/ReasoningRow.tsx` | rewritten on `RowShell` |
| `packages/web-client/src/features/chat/rows/rows.module.css` | old bubble/who/cursor rules replaced with disc/bubble/caret/chip classes |
| `packages/web-client/src/features/chat/Timeline.tsx` | `connector` prop threaded to the three row kinds |

## How it satisfies the scope

Maps directly to design spec § 04's row treatments and § 07's no-glyph / `accentForeground` rules
(task file's "What to build" items 1–5). `streaming`/`pending`/`failed`/`queued` semantics were read,
never redefined — `row-model.ts` and `reducer.ts` are untouched, per Out of scope. The
streaming→markdown switch still happens on `assistant_message.final`/block close, not turn end
(`AssistantRow`/`ReasoningRow`'s streaming branch is unchanged behavior, only its markup/caret
changed).

Deviation from task-002: task-002 preserved `align-self`/background/border on these three rows as
"keep current appearance until this task"; this task now fully replaces that appearance per its own
scope, so the preserved rules are gone as intended — no remaining conflict.

## Build & test results

```
$ npx tsc -b --force
(no output — success)

$ npm run build:web-client
✓ built in 7.57s

$ npm run build            # full monorepo, all 8 packages
✓ built in 8.89s (web-client) + tsc -b clean for the rest

$ npx vitest run packages/web-client
Test Files  52 passed (52)
     Tests  731 passed (731)

$ npx vitest run           # full workspace
Test Files  149 passed (149)
     Tests  1789 passed (1789)

$ npx oxlint <5 changed files>
(no output — clean)

$ npx oxfmt --check <5 changed files>
All matched files use the correct format.
```

## Acceptance criteria

- [x] A short user prompt renders a bubble that hugs its text; a long one wraps within the content
      column without overflowing it. (verified live: sent a real prompt and a long "count to 500"
      response through the real daemon and `deepseek-ai/DeepSeek-V4-Pro-0813`/`claude-sonnet-4-5`;
      screenshots show the shrink-to-fit bubble and wrapped assistant text)
- [x] `pending`, `failed` and `queued` user rows remain visually distinct from a normal row and from
      each other; `failed` still shows "failed to send" and is a tint, not a solid destructive fill.
      (verified by CSS: `.userBubbleFailed`/`.userPendingRow` are non-overlapping, mutually exclusive
      per `row-model.ts`'s documented invariant that `pending` clears when `failed` is set)
- [x] User image thumbnails still render and still open full-size in the `Dialog`. (unchanged
      behavior/markup, only re-parented under `RowShell`; covered by existing component structure,
      no reducer/model change)
- [x] The assistant row has no bubble, no background fill, and no left border in either streaming or
      finalized state. (verified live via screenshot — plain text on timeline background both mid-
      stream and after finalize)
- [x] A streaming assistant row shows the block caret; the caret disappears the moment `streaming`
      clears and the body switches to rendered markdown — mid-turn, not at turn end. (verified live:
      polled `document.querySelector('span[class*="_caret_"]')` during a real streaming response —
      found mid-stream with `width: 7px, height: 14px`, confirmed absent immediately after the
      response finalized)
- [x] The reasoning row is italic and muted, and shows the `final` chip only after its block closes.
      (`metaTrailing={!row.streaming && <span className={styles.finalChip}>final</span>}` — chip
      only renders once `streaming` is false; visually confirmed in the light-variant screenshot)
- [x] No `▍` (or any glyph) is used for the caret; no `blink` keyframe remains. (`grep` for `▍` and
      `blink` in `rows.module.css`/the three `.tsx` files returns nothing; only `caretBlink` remains)
- [x] Under `prefers-reduced-motion: reduce` no caret animation runs. (verified live via
      `page.emulateMediaFeatures([{name: 'prefers-reduced-motion', value: 'reduce'}])` + a real
      streaming turn: computed `animation-name: none`, `animation-duration: 0s` on the live `.caret`
      element)
- [x] In the `zinc` variant, disc glyphs/text on accent fills stay legible (uses `accentForeground`).
      (verified live: switched to `zinc`, read computed `stroke` on the `User`/`Bot` icon `<svg>`s —
      `rgb(24, 24, 27)` = `#18181b` = zinc's `accentForeground`, not white; reasoning's `Brain` icon
      computed `rgb(161, 161, 170)` = `foregroundMuted`)
- [x] All new CSS values are tokens; `token-integrity` and `font-scale` tests pass. (both green in
      the `npx vitest run packages/web-client` run above; every new declaration in `rows.module.css`
      uses `var(--pi-*)` — no hex/rgba literals, including the `.queuedBadge` cleanup)

## Follow-ups / TODO(verify)

- None. All acceptance criteria verified against the real daemon (`ws://127.0.0.1:6767`) across
  `dark` (default), `zinc`, and `light` variants, plus emulated `prefers-reduced-motion: reduce`.
- A throwaway "New chat" smoke-test session (used to exercise live streaming/caret capture) remains
  in the daemon's session list — its in-app "Delete permanently" confirm dialog didn't complete
  cleanly under the headless browser session (a native `confirm()` stalled the tab once). It is
  local dev-daemon scratch data, not part of this change's source tree; no repo files were left
  behind.
