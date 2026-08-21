# Task 008 — Announcements: live region, the seven strings, and the card's group name — Summary

- **Sprint:** sprint-069-extension-ui-attention
- **Completed:** 2026-08-21
- **Status:** done

## What was implemented

One `aria-live` announcement system for extension-UI state, covering both § 08's seven
pending-question events and § 11's `notify`/`set_editor_text` copy, plus the pending card's own
`role="group"` accessible name.

- **`features/agent-ui/announce.ts`** (new, pure): `computeAnnouncements(prev, next, ctx)` diffs
  one `AgentUiState` commit against the one before it and returns every § 08 announcement it
  produces. Covers all seven events: arrival in the active session (includes the prompt, read from
  `payload.title` — the same field every `AskCardBody` variant already reads), arrival elsewhere
  (session-name locator), second-and-later in the same session (count form, regardless of
  active/inactive), and the four resolution rows (answered/submitted, dismissed/declined, expired,
  no-longer-pending) — generalised from `outcome-line.ts`'s own tone/text classification rather
  than a second mapping, including that module's wire-limitation posture verbatim (a populated
  `select`/`input`'s second-Esc dismissal is indistinguishable on the wire from a resolution by
  another client, so both read "No longer pending", never a promised "Dismissed"). Every
  `tone: "success"` outcome collapses to the generic word "Answered" — the module never echoes a
  typed or extension-chosen value, unlike the card's own outcome line, which may print a `select`
  answer verbatim. An arrival only announces when observed live (`receivedAt !== undefined` —
  absent for a snapshot/resync-recovered entry), so a reconnect never re-announces every
  already-pending question. "Nothing pending anywhere" has no string of its own — the module says
  nothing about it; the caller decides when to clear.
- **`stores/announcer-store.ts`** (new): the one shared live-region state — `message`/`politeness`
  — with `speak(text, politeness)` and `clearWhenIdle()`. `clearWhenIdle` is deferred by
  `ANNOUNCE_CLEAR_DELAY_MS` (4s) rather than clearing inline, because emptying the region in the
  same synchronous `setState` as a resolution's own `speak()` would let React coalesce both writes
  into one commit — the resolution text would never actually reach the DOM for a screen reader to
  read. A fresh `speak()` inside that window cancels the scheduled clear.
- **`components/primitives/Announcer.tsx`** (new) + `.module.css`: two always-mounted off-screen
  spans, `role="status"` (`aria-live="polite"`) and `role="alert"` (implicit assertive) — toggling
  a single element's `aria-live` value at runtime is not reliably picked up by assistive tech, so
  `politeness` instead selects which span ever receives text; the other stays empty (silent, not
  announced). Mounted once in `WorkspacePage.tsx`, next to `ToastViewport`.
- **`features/agent-ui/agent-ui-store.ts`**: `announceTransitions`, a second consumer of the same
  `controller.subscribe` commit as `dispatchEffects` — captures `uiState` before the commit, calls
  `computeAnnouncements` after, `speak()`s each result, and calls `clearWhenIdle()` when the global
  pending count reaches zero. `notifyEffect` additionally speaks its § 11 copy (bare message in the
  active session, `"<session>: <message>"` elsewhere — a colon locator, deliberately distinct from
  the toast's own em-dash prefix; `error` → assertive, `info`/`warning` → polite).
  `composerTextEffect` speaks `"Draft replaced in <session>"` only for the background case — the
  visible case's on-screen note (task-007) is already the feedback, per § 11.
- **`features/agent-ui/notify-effect.ts`**: `notifyAnnouncement`, the pure § 11 copy/politeness
  decision, alongside the existing `notifyToastCopy`/`notifyVariant`/`notifyDurationMs`.
- **`features/agent-ui/AskCard.tsx`**: `PendingAskCard`'s card container gains `role="group"` and
  `aria-label={\`Question in ${sessionTitle}\`}`; the ASK badge span gains `aria-hidden="true"` (the
  group's own name already conveys it — exposing both would announce "ASK" twice). `sessionTitle`
  is a new required prop on `AskCard`/`PendingAskCard`, threaded down from `Timeline.tsx`'s own
  `session.title` (`Timeline` already holds the full `SessionEntry`) through `renderComposedItem`.
  Resolved/collapsed cards are static rows, not interactive groups, so neither gets the attribute.
- **`test/reset-stores.ts`**: re-exports `resetAnnouncerStoreForTests` as `resetAnnouncerStore`,
  wired into `agent-ui-store.test.ts`'s existing `beforeEach`.
- **Tests**: `announce.test.ts` (new, 20 tests) — all seven § 08 events, the count-form bump on a
  third arrival, the snapshot/resync-recovered no-announce case, and three dedicated secret-scan
  tests (a `select` answer, an `editor` answer, and an unknown resolution reason) proving no
  typed/chosen value ever appears. `announcer-store.test.ts` (new, 9 tests) — `speak`/`clearWhenIdle`
  timer semantics under fake timers, including the "fresh announcement pre-empts a scheduled
  clear" and "second `clearWhenIdle` restarts rather than stacks" cases. `notify-effect.test.ts`
  (+6 tests) — `notifyAnnouncement`'s locator/politeness matrix. `agent-ui-store.test.ts` (+7
  tests) — full routing through the real controller/reducer pipeline: active-session prompt
  arrival, background locator arrival, snapshot-recovery non-announcement, a real
  `respondToUi`-then-resolve round trip proving a submitted secret value never appears in the
  announcement, the deferred-clear-after-last-resolution timing, `notify`'s § 11 wiring, and
  `set_editor_text`'s background-only announcement.

## Files created / changed

| File | Change |
|---|---|
| `packages/web-client/src/features/agent-ui/announce.ts` | created — pure § 08 transition → announcement decision |
| `packages/web-client/src/features/agent-ui/announce.test.ts` | created — 20 tests |
| `packages/web-client/src/stores/announcer-store.ts` | created — the shared live-region state/actions |
| `packages/web-client/src/stores/announcer-store.test.ts` | created — 9 tests |
| `packages/web-client/src/components/primitives/Announcer.tsx` | created — the two off-screen live-region spans |
| `packages/web-client/src/components/primitives/Announcer.module.css` | created — the `.visuallyHidden` recipe |
| `packages/web-client/src/routes/WorkspacePage.tsx` | mounts `<Announcer />` next to `<ToastViewport />` |
| `packages/web-client/src/features/agent-ui/agent-ui-store.ts` | `announceTransitions`; `notifyEffect`/`composerTextEffect` also `speak()` |
| `packages/web-client/src/features/agent-ui/agent-ui-store.test.ts` | +7 tests; `resetAnnouncerStore` wired into `beforeEach` |
| `packages/web-client/src/features/agent-ui/notify-effect.ts` | `notifyAnnouncement` |
| `packages/web-client/src/features/agent-ui/notify-effect.test.ts` | +6 tests |
| `packages/web-client/src/features/agent-ui/AskCard.tsx` | `sessionTitle` prop; `role="group"`/`aria-label`; `aria-hidden` badge |
| `packages/web-client/src/features/chat/Timeline.tsx` | threads `session.title` through `renderComposedItem` to `AskCard` |
| `packages/web-client/src/test/reset-stores.ts` | `resetAnnouncerStore` re-export |
| `packages/web-client/AGENTS.md` | new "Announcements" invariants section; `role="group"` sub-bullet; source-layout tree entries for `announce.ts`/`notify-effect.ts`/`announcer-store.ts`/`Announcer.tsx`; corrected the sprint-068 "not built this sprint" tail (task-008 now landed, only sprint-070 remains) |

## Deviations and why

None from the task's own scope. One judgment call the task flagged explicitly and asked to be
recorded: an empty incoming `text` replacing a non-empty draft still reads "replaced" (not
"filled") through the standard `pendingFeedback` path — that decision belongs to task-007's own
`draft-store.ts`, already recorded in that task's summary, not re-litigated here.

Accessible names for the collapsed workspace-header dot (task-003) and the tab dot (task-004),
listed as "if those tasks left them as TODO" — verified both already carry `aria-label` (via
`StatusDot`'s `"aria-label"` prop, added by those tasks). No work needed there.

## How it satisfies the scope

- Each of the seven § 08 events produces its exact string — verified by `announce.test.ts` against
  the spec's own table, and by a live run against a real dev daemon + browser (below).
- The active-session arrival includes the prompt; a background one uses the session-name locator —
  both verified live, not just unit-tested.
- A second pending question in the same session produces the count form — verified live with two
  genuinely concurrent `select` dialogs ("2 questions need input in New chat").
- No announcement ever contains a typed `input`/`editor` value or a `select`/`confirm` answer —
  proven by three dedicated unit tests feeding secret-looking values, AND by a live round trip:
  submitted `sk-live-SUPER-SECRET-TOKEN-98765` as a real `input` answer through the real
  reducer/controller pipeline and confirmed it never appears in the resulting announcement text.
- No extension name appears in any string — every locator is the session's own title, never an
  extension identity (none exists on the wire, § 00).
- Clearing the last pending question announces nothing new and the region empties silently —
  verified live: the resolution's own "Answered in …" text is spoken first, then the region reads
  empty after `ANNOUNCE_CLEAR_DELAY_MS` elapses, confirmed both by fake-timer unit tests and by a
  real 4.6s wall-clock wait in the browser.
- One announcement per transition, no repeats on unrelated re-renders — `computeAnnouncements` only
  fires on requestIds newly present versus the previous commit; re-rendering React components reads
  the same store value without re-diffing.
- `notify` and background `set_editor_text` announce per § 11 with the right politeness, locator
  only for background sessions, no extension name — covered by `notify-effect.test.ts` and
  `agent-ui-store.test.ts`'s wiring tests.
- The card exposes `role="group"` with the § 08 name; the ASK badge is not announced separately —
  verified live: `document.querySelector('[role="group"]').getAttribute('aria-label')` read exactly
  `"Question in New chat"`, and the badge's `aria-hidden` attribute read `"true"`.

## Build & test results

```
$ npx tsc -b --force
(clean)

$ npx vitest run
Test Files  192 passed (192)
     Tests  2518 passed (2518)     [+42 new tests over sprint-069/task-007's 2476]

$ npm run lint
(clean on every changed file; pre-existing unrelated warnings elsewhere untouched)

$ npx oxfmt --check <changed files>
All matched files use the correct format.

$ npm run build
✓ built in 10.26s (web-client + cli)
```

## Manual/live verification (dev daemon + real browser, this session)

Drove a real dev daemon + Vite dev server + headless browser end to end (no screen reader available
in this environment — verified the underlying DOM state a screen reader would read from instead, the
closest available substitute for the task's own VoiceOver/Orca/NVDA hand-off recipe):

1. Fired `#ui select` twice in the session being viewed. First arrival:
   `role="status"` read `"A question needs input: Enter a release tag"`-style active-session prompt
   text (a bare "Allow/Block" confirm-style select's own title). Second arrival:
   `"2 questions need input in New chat"` — the exact count form.
2. Answered the first (`respondToUi(..., { value: "Allow" })`): `role="status"` read exactly
   `"Answered in New chat"`.
3. Resolved the last one: the resolution's own `"Answered in …"` text appeared immediately (still
   present at +400ms), then the region read `""` after +4.6s total — the deferred, silent clear.
4. Fired `#ui input` ("Enter a release tag"): active-session arrival correctly included the prompt.
   Submitted a deliberately secret-looking answer
   (`"sk-live-SUPER-SECRET-TOKEN-98765"`) through the real `respondToUi` → reducer → announcement
   pipeline — confirmed it never appeared anywhere in the resulting announcement text.
5. Confirmed via direct DOM inspection: `[role="group"]` on the pending card carries
   `aria-label="Question in New chat"` (the real, live session title, not a hard-coded value), and
   the ASK badge element carries `aria-hidden="true"`.

## Follow-ups / TODO(verify)

- Full audible sign-off with an actual screen reader (VoiceOver/Orca/NVDA) — this task's own
  hand-off note — was not performed in this session (no screen reader available); the DOM-level
  verification above exercises the exact mechanism a screen reader reads from (live-region content
  changes, `role`/`aria-label`/`aria-hidden` attributes) but does not confirm actual audible output
  or announcement timing/interruption behavior across different screen readers. Deferred to
  task-009's consolidated sign-off matrix per this sprint's established convention.
- The one remaining open item for the whole `features/agent-ui/` surface is sprint-070's
  `setWidget`/`setStatus`/`setTitle` (retained-surface) rendering — everything else sprint-068
  identified as "not built this sprint" has now landed across sprint-069's eight completed tasks.
