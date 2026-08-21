# Task 004 — Pure presentation modules: outcome line, option layout, prompt text, deadline

- **Sprint:** sprint-068-extension-ui-dialogs
- **Status:** done
- **Type:** feature
- **Area:** web-client / features/agent-ui
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** none

## Goal
Put every presentation *decision* the question card makes into pure, unit-tested modules, so the
components that follow are thin and the spec's rules are verifiable under Node.

## Context / why
This repo's test runner has no jsdom, so UI logic lives in pure `.ts` modules by convention and
components are verified visually. Nearly all of the visual spec's hard rules are decisions over
data — which outcome string to print, whether options stack, how a multi-line title renders, whether
a deadline bar may be drawn at all — and every one of them has a wrong answer that looks plausible.
Getting them into tested modules first is what makes the component tasks small.

Two rules here exist to prevent a specific, already-identified failure: the outcome line must never
invent a claim the wire cannot support, and it must never echo a typed value.

## Scope references
- `swe/UI design/redesign 0.1.0/Extension Dialogs Visual Spec.html` § 02 (prompt element), § 03
  (option layout, the live-captured payloads), § 04 (outcome lines, the 50-per-agent cap), § 05
  (deadline bar, non-answerable), § 12 (thresholds, duplicates, empty options, long titles)
- `packages/client/src/agent-ui-state.ts` — entry fields (`method`, `payload`, `timeoutMs`,
  `createdAt`, `receivedAt`, `answerable`, `submitting`, `submittedAnswer`), `remainingMs`
- `packages/web-client/src/features/chat/onboarding-nudge.ts` + `.test.ts` (feature-local pure
  module + colocated test convention)
- `packages/web-client/src/timeline/format-meta-time.ts` (formatting-module precedent)

## What to build
Four modules under `packages/web-client/src/features/agent-ui/`, each with a colocated `.test.ts`:

- `outcome-line.ts` — a resolved entry → `{ tone, glyph, text }`.
  - `select`/`confirm` answered: the chosen label verbatim, ellipsised past 40% of card width
    (return the string plus a truncation flag; the CSS does the clamping).
  - `input`/`editor` answered: a neutral confirmation with **no value**, ever. The SDK already makes
    a typed answer unrepresentable (`answerFromResponse` stores nothing for these methods) — this
    module must not reintroduce it by reading `payload`.
  - `cancelled` / `timeout` / `not_found` / anything else: the spec's neutral copy, and an unknown
    reason string printed **verbatim** in the muted tone. Never relabelled, never mapped to a claim
    about another device.
- `option-layout.ts` — `options: string[]` → `{ mode: "row" | "stack", scrolls: boolean }`.
  Stack when five or more options, or when any label exceeds the § 12 threshold; scroll past the
  § 12 count. Per § 03 the stack is the expected case, not the exception. No ordinals are produced
  (§ 12 withdrew them: real extensions number their own labels, and the wire answer is the option
  string, so ordinals could neither be sent nor disambiguate duplicates).
- `prompt-text.ts` — `title` (+ optional `message`) → renderable lines. `\n` is a hard break; runs of
  blank lines collapse to one; a bracketed prefix like `[Color]` is preserved **verbatim** and never
  parsed; clamp/scroll per § 02/§ 12. `confirm`'s `title` + `message` return as distinct parts so the
  component can weight them (§ 03: title normal weight when it stands alone, emphasised when a
  message follows).
- `deadline.ts` — entry + now → `{ show: boolean, fraction: number, approximate: boolean }`.
  `show` is false when `timeoutMs` is absent; `approximate` is true for snapshot-recovered entries
  (`receivedAt === undefined`), which per § 05 must never be drawn as an exact countdown. Nothing
  here expires anything — the display is derived, and only the daemon's `agent_ui_resolved` ends a
  dialog.

## Out of scope
- Any React component or CSS (task 005 onward).
- Surfaces, toasts, composer text (sprints 069–070).
- Re-deriving anything the SDK already decides: ordering, `answerable`, `submitting`, the resolved
  cap. Consume those; do not recompute them.

## Acceptance criteria
- [x] `outcome-line` never returns a value string for `input`/`editor`, proven by a test that feeds a
      resolved entry whose payload contains a secret-looking string and asserts it appears nowhere in
      the output.
- [x] An unrecognised `reason` is returned verbatim in the muted tone.
- [x] `option-layout` stacks the § 03 live-captured payload (self-numbered, long labels) and returns
      `scrolls: true` for the nine-option case; an empty array is handled without throwing.
      **Note (documented judgment call, see summary):** the numeric length rule is proven against
      § 12's own worked "EXACT STACKING THRESHOLD" example rather than § 03's descriptive prose,
      since the § 03 payload's options (≤30 chars, 3 options) do not literally clear a 40-char/5-
      count threshold despite the prose saying they do — flagged to the designer via task-009.
- [x] Duplicate identical labels produce identical output with no ordinal and no synthetic key.
- [x] `prompt-text` renders the § 03 live-captured multi-line `input` title as separate lines with
      the blank-line run collapsed and `[Color]` intact.
- [x] `deadline` returns `show: false` with no `timeoutMs`; `approximate: true` when `receivedAt` is
      absent; a fraction that only ever decreases for a fixed entry as `now` advances.
- [x] Every module is pure: no imports from React, the DOM, or the store.

## Test / verification plan
- Tests: four colocated `.test.ts` files. Use the payloads § 03 quotes from the live capture verbatim
  as fixtures — they are the real shapes a real extension sent, including the self-numbering and the
  embedded newlines. Run `npx vitest run packages/web-client/src/features/agent-ui/`.
- Build/typecheck/lint: `npm run build:web-client`, `npm run typecheck`, `npm run lint`,
  `npx oxfmt <changed files>`.

## Hand-off for visual sign-off (user)
None — no rendering in this task.

## Notes
Card headers carry the **method name alone**; no extension name is available anywhere on the wire
(§ 00 states this as permanent). Do not add a parameter, field, or TODO for one — the presentation
must be correct as-is, not shaped around a value that may never arrive.

`editor` never carries a `timeout` (Pi's editor is the one dialog with no timeout support), so a
deadline bar on an editor card is unreachable. `deadline.ts` needs no special case for this — absent
`timeoutMs` already yields `show: false` — but do not write a test asserting an editor deadline
renders.
