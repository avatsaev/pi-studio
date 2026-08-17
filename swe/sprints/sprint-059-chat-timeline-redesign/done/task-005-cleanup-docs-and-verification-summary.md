# Task 005 — Dead-style sweep, shared conventions, spec/docs sync, cross-variant verification — Summary

- **Sprint:** sprint-059-chat-timeline-redesign
- **Completed:** 2026-08-17
- **Status:** done

## What was implemented

1. **Dead-style sweep.** Confirmed (by usage search, not by eye) that tasks 002–004 already removed
   every orphaned rule as they landed — `.who`, `.user`/`.assistant`/`.reasoning`/`.streaming`/
   `.cursor`, `@keyframes blink`, the old `.tool`/`.toolHeader`/`.toolChevron*`/`.toolIcon*`/
   `@keyframes pulse`, and the now-unused `.row` bubble wrapper are all gone (verified in each task's
   own summary, re-confirmed here with a fresh grep across `rows.module.css`/`Timeline.module.css`/
   `RowShell.module.css`: zero unused class/keyframe names, zero `▍`, zero `blink`, zero `align-self`,
   zero `max-width: 85%`). Nothing was left for this task to remove — the three implementer tasks
   already swept their own debris per their own Notes sections.
2. **Reduced-motion audit.** One gap found and fixed: the retained "Agent is working…" bouncing-dots
   indicator (`Timeline.module.css`'s `workingBounce`) had no `prefers-reduced-motion` handling. Added
   `@media (prefers-reduced-motion: reduce) { .workingDots span { animation: none; opacity: 1; } }`.
   The streaming caret (`caretBlink`) and the `Spinner` primitive's rotation (`piSpinnerRotate`)
   already had one each (task-003 and task-004 respectively) — confirmed by grepping every
   `animation:`/`@keyframes` declaration across the four timeline-adjacent CSS files and checking each
   has a matching reduced-motion override.
3. **Conventions written down.** Added two invariants to `packages/web-client/AGENTS.md`'s
   `## Invariants` section: `statusSuccess`-not-`success` (dark variants alias `success` to accent)
   and `accentForeground`-not-hardcoded-white (the `zinc` variant's accent is near-white).
4. **Spec sync.** `swe/features/timeline-rendering.md` updated, not rewritten:
   - A callout after the "Row kinds" table states the web client's actual `TimelineRow` union is the
     narrower six kinds (`user`/`assistant`/`reasoning`/`tool`/`error`/`system`) and that
     `thought`/`todo_list`/`activity_log`/`compaction`/plan/speak rows describe reference-app behavior
     this client has never implemented — not something this sprint removed.
   - The "User message"/"Assistant message"/"Reasoning" bullets under § Row treatments are rewritten
     to describe the shipped `RowShell` rail/disc/meta-line/caret design (shrink-to-fit bubble, no
     bubble at all, italic-muted + `final` chip), explicitly noting the old right-aligned/notched
     bubble and the "collapsible block group" behavior are gone/never-implemented respectively.
   - A callout after the § Tool-call cards intro paragraph documents the shipped kind-badge/primary-
     field/trailing-status/output-strip/diff-preview/Open design, and flags that the "Status
     visuals"/"Layout"/icon-and-name-mapping content below it describes the richer reference-app model
     (`displayName`/`isPlan`/bottom sheet/hover-reveal chevron/`StatusBadge`) the web client does not
     implement.
   - Everything outside those three spots (Activity log, Compaction, Todo, Speak, Plan card bullets;
     the Icon/Display-name/Expanded-detail sub-tables) is untouched per Out of scope — it was already
     reference-app-only before this sprint, not made untrue by it.
5. **Verification sweep** (§ 07's list) — see below.

## Files created / changed

| File | Change |
|------|--------|
| `packages/web-client/src/features/chat/Timeline.module.css` | added `prefers-reduced-motion` override for `workingBounce` |
| `packages/web-client/AGENTS.md` | added `statusSuccess`/`accentForeground` invariants |
| `swe/features/timeline-rendering.md` | three callouts + rewritten Row-treatments bullets, syncing it to the shipped design |

No component/logic files changed — tasks 001–004 already implemented and unit-tested every behavior
this task verifies; this task's own code change is the one-line reduced-motion CSS fix.

## How it satisfies the scope

Every "What to build" item (1–5) is covered above. Out-of-scope items (sidebar/composer/queue
chips/TurnProgressBar/FileExplorer/pane headers, removing the working-dots indicator, jsdom
infrastructure, a wholesale `timeline-rendering.md` rewrite) were not touched.

## Build & test results

```
$ npm run typecheck        # tsc -b, full workspace
(clean)

$ npx vitest run           # full workspace
Test Files  149 passed (149)
     Tests  1789 passed (1789)

$ npx oxlint <18 sprint-059-changed files>
(no output — clean)

$ npx oxfmt --check <18 sprint-059-changed files>
All matched files use the correct format.
```

`npm run lint`/`npm run fmt:check` at the whole-repo level report pre-existing warnings/formatting
gaps in files this sprint never touched (e.g. `packages/client/src/daemon-client.ts`,
`packages/server/src/daemon/bootstrap.ts`, assorted `.md`/`package.json` files) — confirmed via
`git status` that none of them are in this session's changed-file set. Per this task's own Notes
("leave it and note it — an unrelated cleanup inflates the diff"), they are left alone; scoped
lint/format checks against every file sprint-059 touched are clean, which is what's recorded above.

## Acceptance criteria

- [x] No unused class or keyframe remains in `rows.module.css`/`Timeline.module.css`; each removal
      was confirmed by searching for usages across `packages/web-client/src`. (all removal already
      happened in tasks 002–004; re-verified via fresh grep, zero orphaned selectors found)
- [x] No `▍` glyph, `blink` keyframe, `align-self`, or `max-width: 85%` bubble rule remains in the
      timeline styles. (grepped `rows.module.css`/`Timeline.module.css`/`RowShell.module.css`; the
      only remaining `▍` mention is a code comment explaining what the caret replaced)
- [x] Every timeline animation is neutralized under `prefers-reduced-motion: reduce`. (`caretBlink`,
      `piSpinnerRotate`, and now `workingBounce` — verified by grepping every `animation:`/
      `@keyframes` in the four timeline CSS files and confirming a matching override)
- [x] `packages/web-client/AGENTS.md` states both token rules with their reasons. (added to
      `## Invariants`, one line each + reason, formatted with `npx oxfmt`)
- [x] `swe/features/timeline-rendering.md` describes the shipped rows; no section still claims the
      web client renders right-aligned user bubbles or a bordered assistant card. (rewritten bullets
      confirmed above; the old "right-aligned bubble"/"notched top-right corner"/bordered-assistant
      wording no longer exists in the User/Assistant/Reasoning bullets)
- [x] `npm test` (full suite) and `npm run typecheck` pass; lint/format are clean on every file this
      sprint touched. (see Build & test results; whole-repo `lint`/`fmt:check` pre-existing gaps are
      outside this sprint's changed-file set, confirmed via `git status`, and intentionally left alone
      per this task's own Notes)
- [x] The § 07 verification list is executed and its results recorded below, including the `light`
      and `zinc` checks and the compact-width check, each stated as observed, not assumed.

## § 07 verification sweep — observed results

All against the real daemon (`ws://127.0.0.1:6767`, provider `pi`), not synthetic fixtures, unless
noted:

- **`token-integrity.test.ts` + `font-scale.test.ts`**: green (part of the 1789-test full-suite run
  above) — no dangling or illegal token.
- **Theme variants — `zinc`**: switched via `localStorage["pi-studio-appearance"]` +
  reload (the app's persisted-settings mechanism; no in-app theme switcher UI exists yet). Read
  computed styles live against a real session with SHELL/READ/TASK tool cards: kind-badge text/
  background/border all derive from the near-white zinc accent (`rgb(228,228,231)` text on a 20%-mix
  background, never a solid fill) — legible, and consistent with task-003's own zinc verification of
  the `User`/`Bot` rail-disc icons (`accentForeground` = `#18181b`, not white).
- **Theme variants — `light`**: same switch mechanism. Caught a **real** `ErrorRow` (a genuine OAuth
  refresh failure, not synthetic) rendering as a darkened pink-red card with dark-red text — confirms
  the `color-mix` fill darkens rather than lightens on the light variant. A `SHELL`/`READ` kind badge
  in the same theme showed dark navy text (`rgb(37,62,111)`) on a pale-blue 20%-mix background, and an
  `EDIT` badge showed dark amber text on pale amber — same darken-not-lighten confirmation for
  `statusWarning`. A user-message bubble showed dark text on a pale accent-tinted fill.
- **Theme variants — `dark`, `midnight`, `claude`, `ghostty`**: not independently eyeballed this pass
  (all five non-`light` variants share `buildDarkColors`, and `dark` is the default already exercised
  throughout every other manual check in this sprint); `token-integrity.test.ts` iterates all six by
  construction, so no variant is missing a token.
- **Compact width (< 576px)**: set the viewport to 420×760 and hid both sidebars to expose the chat
  pane at full compact width. Measured `scrollWidth` vs `clientWidth` on every element in the page:
  the chat viewport itself is `420/420` (zero horizontal overflow); the only element with
  `scrollWidth > clientWidth` inside the timeline is the `ToolCard` primary-field `<span>`
  (`overflow: hidden; text-overflow: ellipsis; white-space: nowrap` — i.e. truncating exactly as
  designed, not overflowing the page). The one page-level horizontal scrollbar found (`html`/`body`
  737 vs 420) originates in the top connection toolbar (host/password inputs + buttons in a single
  row) — a pre-existing, out-of-scope component this sprint never touches, not the timeline. A
  screenshot at this width shows User/Reasoning/WRITE/EDIT rows and their badges, diff stats, status
  text and `Open` button all fitting on one line with no clipping; the `Open` button is always
  rendered (not hover-gated), so nothing hover-only is unreachable at this width.
- **Long strings**: confirmed via the compact-width pass above — a `WRITE` card's `/tmp/tool-card-…`
  path and an `EDIT` card's diff stats both ellipsis-truncate with the full value still available via
  `title`, no wrap, no layout shift, no scrollbar. (Task-004's own summary additionally live-verified
  a long shell command and a deep file path pre-truncation at desktop width.)
- **Live streaming turn end-to-end**: sent three real prompts through the running daemon session.
  Observed: a `sleep`-backed `SHELL` tool card in `running` state (`Spinner` + accentBright "running"
  text + accent-tinted border/wash) transition to `✓ completed` (`statusSuccess`) once the command
  exited; the timeline auto-scrolled to keep the newest row in view through the whole turn without any
  manual scroll call; rail continuity held across the full mixed sequence of User → Assistant →
  Reasoning → Tool rows (connector line unbroken, discs aligned) both before and after the new turn.
  The caret → markdown flip specifically was not re-caught live in this pass (the model's responses
  streamed and closed faster than the polling loop could sample mid-stream) — it was already caught
  and measured directly in task-003's own verification (`width: 7px, height: 14px` mid-stream,
  confirmed absent immediately after finalize), which this task treats as still-valid evidence rather
  than re-deriving it.

## Follow-ups / TODO(verify)

- None blocking. The five non-`light` theme variants were not independently screenshotted this pass
  (see above) — low risk, since they share one color builder with `dark`, which was exercised
  throughout, and `token-integrity.test.ts` asserts token completeness for all six mechanically.
- No new scratch files or sessions were created during this task's verification (reused existing
  daemon sessions and the already-known "New chat" leftover documented in task-003/004's summaries).

## Addendum — user-driven right-align fix (post-completion)

After this task was marked done, the user reported that the design's uniform left rail made their
own messages blend into the assistant/tool rows instead of standing out. Design spec § 04's
left-rail-for-everything treatment was a deliberate re-skin decision, but it traded away a real
usability signal (chat convention: your own messages read at a glance). Fixed by right-aligning the
user row's *content* — bubble, meta line, and image row — within its `RowShell` content column,
while leaving the rail disc/connector in their fixed left column so rail continuity across row
kinds is unaffected:

- Added `.userAligned` (`display: flex; flex-direction: column; align-items: flex-end;`) to
  `rows.module.css`, applied unconditionally on `UserRow`'s `RowShell` `className` (combined via
  `clsx` with the existing conditional `.userPendingRow`).
- Updated `UserRow.tsx`'s doc comment to explain the right-alignment and why the rail itself stays
  put.
- Corrected `swe/features/timeline-rendering.md`'s "User message (web-client)" bullet, which this
  task had just (incorrectly, in hindsight) written to say the row is *not* right-aligned anymore —
  it now describes the `.userAligned` mechanism and notes it reaches the same right-aligned visual
  outcome as the pre-sprint-059 design, by a different mechanism (a flex-aligned content column,
  not a legacy notched full-width block).

Verified live against the real daemon at both desktop (1280px) and compact (420px) widths: the
bubble, meta line and image row all hug the content column's right edge; the rail disc/connector
stay in their normal left position; no horizontal overflow at 420px (`viewport` `scrollWidth ===
clientWidth === 420` both before and after). `npx tsc -b --force`, `npx oxlint`/`npx oxfmt --check`
on the two changed files, and `npx vitest run packages/web-client` (52 files / 731 tests) all clean.

## Addendum 2 — user-driven green disc for the User row's rail marker (post-completion)

User asked for the `UserRow` rail disc/icon to be green so it reads as distinct from the other
(blue-accent) discs at a glance, "following the design system color palette" — iterated live
against direct feedback on each attempt:

1. First pass: `.userDisc` background = `color-mix(statusSuccess 25%, surface3)` (the same
   low-opacity tint recipe `ErrorRow`/`ReasoningRow` use for their non-accent discs), icon color =
   full-strength `statusSuccess`. Rejected — "too bland, doesn't pop" and "the icon color almost
   blends with background" (icon and disc background share the same hue, so even at 25% mix the
   icon didn't stand out against its own disc).
2. Second pass: solid `background: var(--pi-color-statusSuccess)` fill, icon color =
   `var(--pi-color-successForeground)` (white — the existing token pairing for a solid
   success-family fill; `successForeground` is a literal `#ffffff` in every variant, same value
   `destructiveForeground` already uses for `destructive` fills, so this isn't a new hardcoded
   color). Rejected — "the green pops too much" (green-600/700 at full saturation next to the
   otherwise muted dark-theme palette read as too loud for a small always-visible rail marker).
3. Final: `background: color-mix(in srgb, var(--pi-color-statusSuccess) 65%, var(--pi-color-
   surface3))`, keeping the white `successForeground` icon. Confirmed live (screenshot) — reads as
   a clear, confident, distinctly green marker with a legible white icon, calmer than the raw
   token, sitting comfortably next to the blue assistant/`Bot` discs without shouting.

`UserRow`'s bubble fill is untouched (still accent-tinted) — only the rail disc/icon changed, per
the literal ask. `token-integrity`/`font-scale` unaffected (no new token introduced; `statusSuccess`
and `successForeground` both already exist and are used elsewhere). Re-ran `npx tsc -b --force`,
`npx oxlint`/`npx oxfmt --check` on the two changed files, and `npx vitest run packages/web-client`
(52 files / 731 tests) after the final pass — all clean.

## Addendum 3 — ToolCard interactivity affordance + kind-badge contrast (post-completion)

Three related, user-requested fixes to `ToolCard`, landed together since the badge-color fix was
discovered while addressing the first two:

1. **Hover affordance.** `.toolHeader` had `cursor: pointer` but no visible hover feedback, so
   nothing signaled the (already-clickable) header was interactive. Added `.toolHeader:hover:not(
   [aria-disabled="true"])` (the same theme-adaptive `foreground`-mix hover-lift idiom
   `SessionList.module.css`'s `.workspaceHeader:hover` already uses) plus a
   `.toolHeader.toolHeaderRunning:hover` variant that intensifies the existing accent wash instead
   of switching to the generic lift (which would clash with the running state's accent border).
   Bodyless cards (`aria-disabled="true"`, nothing to expand) get no hover feedback. Verified live:
   computed `background-color` on the header element flips between `rgba(0,0,0,0)` (rest) and a
   visible `foreground`-lifted color (hover).
2. **Text-selection-on-click.** Clicking the header to toggle expand/collapse could drag a text
   selection across the badge/path/status if the click had any pointer movement. Added
   `user-select: none` to `.toolHeader` only — the expanded body's diff/code/output stays
   selectable, since that's content users actually want to copy.
3. **Kind-badge contrast**, iterated live against direct feedback on each attempt:
   - `shell`/`read`/`search`/`fetch` badges used `token: "accent"` — rejected ("too blue dark and
     not contrasty enough against the background"): `accent` on the default `dark` theme
     (`#2e5cb8`) is a genuinely dark navy, poor as small standalone text on a near-black card.
   - Tried `token: "accentBright"` (the token this app already uses when accent-family content
     sits on a dark surface as text, e.g. the running-status text) — rejected ("too pale"):
     `accentBright` (`#a2b4d7` on `dark`) fixed contrast but reads as a desaturated, washed-out
     hue, not a confident label.
   - Root cause: `accent`/`accentBright` are brand tint tokens that vary per theme variant (navy on
     `dark`, near-white on `zinc`) — neither shade of a variable, sometimes-pale tint can reliably
     double as vivid, always-legible badge text. `statusSuccess`/`statusWarning` never had this
     problem because they're already fixed, theme-invariant colors (`DARK_STATUS`/`LIGHT_STATUS` in
     `theme/colors.ts`), not derived from the variant's accent.
   - Added a new `statusInfo` token to `ThemeColors` (`theme/colors.ts`), following that exact
     existing pattern: `#3b82f6` (blue-500) in `DARK_STATUS`, `#2563eb` (blue-600) in `LIGHT_STATUS`
     — a fixed, vivid, theme-invariant blue. `css-bridge.ts`'s emission loop is generic over
     `Object.entries(semanticColors)`, so `--pi-color-statusInfo` is emitted automatically in every
     variant with no other wiring. Switched `shell`/`read`/`search`/`fetch` in
     `tool-mapping.ts`'s `BADGE_BY_KIND` to `token: "statusInfo"`; updated `tool-mapping.test.ts`'s
     four affected assertions to match. Verified live: computed badge `color` reads
     `rgb(59, 130, 246)` (`#3b82f6`), visibly vivid and legible against the dark card.

Updated `ToolCard.tsx`'s doc comment (hover/selection) and `swe/features/timeline-rendering.md`'s
"Web-client tool card" callout (kind-badge token + hover/selection) to match. `token-integrity`/
`font-scale` unaffected by the new token — both are fully dynamic over whatever `ThemeColors` emits,
no hardcoded token list to update. Re-ran `npx tsc -b --force` (clean), `npx oxlint`/`npx oxfmt
--check` on every changed file (clean), and the full workspace suite: 149 files / 1789 tests green.
No scratch files left behind; the throwaway `New chat` session created to trigger a live `SHELL`
tool card for verification remains in the daemon's session list (same known cleanup gap noted in
task-003/004's summaries — not part of this change's source tree).
