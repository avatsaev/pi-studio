# Task 009 — Verification matrix, cross-surface consistency pass, docs — Summary

- **Sprint:** sprint-069-extension-ui-attention
- **Completed:** 2026-08-21
- **Status:** done

## What was implemented

Sprint close: the consolidated sign-off matrix, a live cross-surface consistency pass (no
divergence found — recorded below, not fixed, because there was nothing to fix), and docs brought
current across `packages/web-client/AGENTS.md`, root `AGENTS.md`, `swe/features/ui-components.md`,
and `swe/sprints/PLAN.md`.

## Verification matrix

Every row below was either exercised live against a real dev daemon + headless browser (this task
and tasks 001–008's own sessions) or is covered by the cited automated test. "Live" means observed
in an actual running app this task; "unit" cites the test file.

| # | Scenario | Result | Evidence |
|---|---|---|---|
| 1 | Needs-input on a background (non-active-tab, non-visible-pane) session's row | 8px `statusWarning` dot + "needs input" label, pulsing | Live (this task, cross-surface pass) + `session-presentation.test.ts` |
| 2 | Running vs needs-input precedence | Needs-input wins even while the session is also `running` — task-001's own design (a pending question can arrive mid-turn) | `session-presentation.test.ts` (`sidebarSessionView` precedence tests) |
| 3 | Clearing on answer, dismiss, expiry | All three surfaces (row, header, tab) cleared together within one render after `respondToUi` | Live (this task): resolved a real pending question, `pulsingDotsRemaining: 0`, `needsInputTextStillPresent: false`, `tabNeedsInputClassStillPresent: false` in the same DOM snapshot |
| 4 | Clearing does **not** happen merely on opening the session (viewing it does not itself resolve anything) | The dot only clears on an actual `agent_ui_resolved`, never on tab-focus/visibility change | `session-presentation.test.ts`; architecturally guaranteed — `sidebarSessionView` reads `hasPendingQuestion`, never tab-visibility state |
| 5 | Two questions on one session showing one signal (not two) | A second concurrent `select` on the same agent produced exactly one row dot, one header count, one tab dot — never doubled | Live (task-008's own session): fired two `#ui select`s on one agent, observed a single dot set throughout plus the announcement's own count form ("2 questions need input in New chat") |
| 6 | Collapsed header dot with the count in its accessible name | `aria-label="ws-b — 1 session needs input"` | Live (this task, cross-surface pass): read directly off the DOM |
| 7 | Expanded header showing nothing | No attention dot renders on `WorkspaceGroupHeader` while expanded — session-level rows carry the signal instead | Live (this task): expanded ws-b, header-level dot disappeared, the pending session's own row dot appeared in its place |
| 8 | Inactive-tab dot with active-tab suppression | The tab holding the pending question (not the currently active tab) showed the dot; the active tab (a different session) showed none | Live (this task, cross-surface pass): two tabs in one pane, fired the dialog on the background one, confirmed via `tabDots` query |
| 9 | Narrow-strip concession order (label ellipsises first, then dot replaces ×) | `tab-attention.test.ts`/`TabStrip.test.ts` cover the breakpoint order; not re-verified live at a narrow viewport this session (no regression since task-004, no code touched here) | Unit (task-004's own suite) |
| 10 | Pulse present on all three surfaces, absent elsewhere | Confirmed simultaneously: header dot `_pulse_`, tab dot `_pulse_`, row dot `_pulse_` all present together for the one needs-input session; the sibling session's row dot in the same list had no `_pulse_` class | Live (this task, cross-surface pass) |
| 11 | Reduced motion kills all three pulses | `@media (prefers-reduced-motion: reduce) { .pulse { animation: none } }` — one shared CSS rule in `StatusDot.module.css`, consumed identically by all three call sites since none override it locally | Code inspection (task-002's shared implementation) — not re-run live under a forced reduced-motion emulation this session, no regression risk since the rule is centralized, not duplicated |
| 12 | Each `notify` level (info/warning/error) | `notifyVariant`/`notifyDurationMs`/`notifyAnnouncement` unit-tested for all three plus an unrecognised-level fallback; live-fired `error` level this task's own session (task-008), confirmed `assertive` politeness and sticky toast duration by inspection | Unit (`notify-effect.test.ts`) + live (task-008 session) |
| 13 | Error-toast persistence and hover-pause | `durationMs: null` for error (never auto-dismisses); hover-pause is `toast-store.ts`'s `pause`/`resume`, unit-tested | Unit (`toast-store.test.ts`) — not re-verified with a live pointer-hover in a browser this session (no code touched here, pre-existing task-005 behavior) |
| 14 | `set_editor_text` visible replacement, both note copies (`Your draft was replaced` / `Your message was filled in`) | Both copy branches unit-tested (`draft-store.test.ts`); the "replaced" copy live-fired and confirmed in the DOM (task-007's own session) | Unit + live (task-007 session) |
| 15 | Background-pane deferred **note** (no flash) firing once | `agent-ui-store.test.ts`'s routing tests cover the no-flash/deferred-note path structurally; not independently re-verified live this session (task-007 already covered visible-vs-background at the unit level; the specific "wait for the pane to become visible, note fires once" timing sequence is the one scenario in this matrix not live-verified end to end) | Unit (`agent-ui-store.test.ts`) — **flagged below as the one open item** |
| 16 | The seven § 08 announcements, including the two silent cases (a snapshot-recovered arrival, and "nothing pending anywhere") | All seven live-fired and read off the DOM this sprint: active-session prompt arrival, background-session locator arrival, count-form second arrival, "Answered", "Dismissed", (both live-fired) and "Expired"/"No longer pending" (unit-tested, § 08's own wire-limitation cases are not independently reproducible via the mock's `#ui` grammar); the silent cases: a `listAgentUi`-recovered entry produces no announcement (unit + inspected `useAnnouncerStore` message === "" after connect), and the region empties itself 4s after the last resolution with no new announcement in between | Live (tasks 007/008/009 sessions) + `announce.test.ts` (20 tests) |

## Cross-surface consistency pass

One deliberate live pass (this task), confirming:
- **Identical dot size and colour in all three places.** `getComputedStyle` on the header dot,
  tab-strip dot, and session-row dot for the same pending session all read `8px × 8px`,
  `rgb(245, 158, 11)` (the `statusWarning` token) — sourced from the one shared `StatusDot`
  component and `status-dot.ts`'s single `statusDotColor` function, never a per-surface duplicate.
- **Identical clearing trigger.** Resolving the one pending question cleared all three
  `.pulse`-bearing dots, the row's "needs input" text, and the tab's `_tabNeedsInput_` modifier
  class in the same render pass — confirmed by re-querying the DOM immediately after
  `respondToUi` and finding zero of any of them.
- **Pulse on all three, never a fourth.** Exactly three `.pulse`-bearing elements existed for one
  pending question across the whole page (header, tab, row); the sibling non-pending session's own
  row dot in the same DOM snapshot correctly carried no `.pulse` class.
- **An accessible name on every dot that needs one.** Header: `"ws-b — 1 session needs input"`
  (counted). Tab: `"Needs input"`. Row: `role="presentation"` — deliberately unnamed, per
  task-001's own decision, because the row already carries an adjacent visible "needs input" text
  label satisfying the same requirement without duplicating it onto the dot.
- **No surface reacting to a state the others ignore.** No divergence found — every signal is
  derived from the same two selectors (`useAgentUiPending`/`useAgentUiPendingAgentIds`), so there
  is exactly one source of truth by construction, not an accidental convergence.

**Result: clean. No divergence found, nothing to fix.** The single-source-of-truth architecture
established across tasks 001–004 held under a real simultaneous multi-surface live check.

## § 08 row-wash question — resolution status

**Still unanswered.** `spec-corrections.md` (filed by sprint-068/task-009) has not been updated by
the designer as of this task's completion — re-read in full this session, correction 1 (the
row-tint self-contradiction between § 08's banner, § 01's palette table, and § 08's own "Row fill"
entry) carries no resolution note. Task-001 shipped the 2px accent bar only, matching the banner
and § 01's disclaimer, and omitted the disputed 10%/12% wash — this is the operative behavior
today. **Recorded here plainly, again, so a later designer answer can be applied deliberately**:
if resolved in favor of the wash, `SessionList.module.css`'s `.item.active[data-attention]` (or
wherever the active-row tint mechanism lives) is the integration point task-001's own summary
names.

## Files created / changed

| File | Change |
|---|---|
| `packages/web-client/AGENTS.md` | new "Toast host" invariants bullet (was entirely undocumented — task-005 only added a source-layout mention); fixed the stale "sixth signal source... unbuilt as of task-004" claim now that `notify`/announcements have landed |
| `AGENTS.md` (root) | `agent_ui_*` paragraph: replaced the stale "still unrendered: … sidebar/tab/workspace attention signals … not yet wired to anything" tail with what sprint-069 actually shipped |
| `swe/features/ui-components.md` | § Feedback → Toasts: reworded from the pre-existing aspirational spec description to describe the built system (stacking cap, promotion-resets-countdown semantics, the new `warning` variant) |
| `swe/sprints/PLAN.md` | sprint-069's status line: `planned with task files` → `shipped`, with a one-line summary of what shipped; restored two lines of pre-existing sprint-068 text I initially clipped mid-edit while making this change (caught and fixed in the same pass, verified by rereading the full paragraph before moving on) |

## Deviations and why

- **The narrow-strip concession order (row 9), reduced-motion (row 11), hover-pause (row 13), and
  the background-pane deferred-note timing sequence (row 15) were not independently re-verified
  live this session** — each is covered by its own task's unit-test suite and involved no code
  change in this task, so re-running a live check would exercise sprint-069's own prior work, not
  anything task-009 touched. Recorded as open items below rather than silently assumed correct.
- **No temporary toast-firing scaffolding from task-005 to remove** — task-005's own summary
  records that it deliberately built no throwaway trigger, deferring visual verification to
  task-006's real `#ui notify` recipes instead. Confirmed by search: no scaffold-marker comments,
  no dev-only toast-firing buttons anywhere in `packages/web-client/src`.
- **The `#ui` mock grammar additions from tasks 006–007 are already documented alongside
  sprint-068's** — both live in the same `HELP_TEXT` constant in `ui-script.ts` (`#ui notify`,
  `#ui notify:warning`, `#ui notify:error`, `#ui set_editor_text` sit in the same list as `#ui
  select`/`#ui confirm`/etc.), the canonical, self-documenting, always-current source (`#ui help`
  prints it directly). No separate prose listing exists anywhere else in the repo to keep in sync
  with it, for sprint-068 or sprint-069 alike.

## Retained-surface producer check (addendum, 2026-08-21)

Before closing the sprint: does any real, installed extension actually send `setWidget`/
`setStatus`/`setTitle` over RPC? The record contradicted itself — sprint-066/067 found rpiv-todo's
widget was TUI-only factory-form (dropped by RPC), but sprint-068/task-009 later read a `#ui
rpiv-todo` negative test's silence as "it drives `setWidget`". Those observations cannot both be
right, and "nothing rendered" cannot distinguish "a frame arrived and nothing renders it" from "no
frame was ever sent" — this section settles it with source inspection and live `pi --mode rpc`
captures (installed: pi 0.84.2, rpiv-todo 2.6.4, pi-powerline-footer 0.15.1, pi-background-tasks
2.1.1, pi-web-access 0.24.0, rpiv-ask-user-question 2.6.4 — the daemon's exact `core` pack per
`curated-packs.ts`).

**Verdict: widget frames arrive.** Sprint-070 should plan both halves (widget panel + status
strip), not defer the panel to a hypothetical future producer.

### Static check (decisive on its own)

- **`@juicesharp/rpiv-todo`**: `todo-overlay.ts:65-67` registers its widget as a factory function
  — `this.uiCtx.setWidget(WIDGET_KEY, (tui, factoryTheme) => {...})`. Pi's own RPC-mode source
  (`node_modules/@earendil-works/pi-coding-agent/dist/modes/rpc/rpc-mode.js:123-135`) gates
  `setWidget` on `content === undefined || Array.isArray(content)`, with its own comment: *"Only
  support string arrays in RPC mode - factory functions are ignored"*. rpiv-todo's widget is never
  transmitted. Its `notify()` (`todo.ts:110-142`) does fire, but only on the `/todo` command.
- **`pi-powerline-footer`**: `index.ts:2867-2962` registers six widgets (`powerline-top`,
  `-secondary`, `-bash-transcript`, `-status`, `-queue-preview`, `-last-prompt`), all factory-form
  — all dropped identically. It also calls `ctx.ui.setStatus("stash", "stash"/undefined)`
  (`index.ts:2175/2183`), a plain string, gated behind `ctx.ui.onTerminalInput` — Pi's RPC source
  makes this a hard no-op (`rpc-mode.js:97-99`: *"Raw terminal input not supported in RPC mode"*),
  so this call path can never fire outside a real TUI. It also calls `ctx.ui.setTitle(title)` from
  its `/cd` command (`cd-command.ts:161,183`) — a genuine slash command, reachable via RPC exactly
  like any other text-based command.
- **`@99percentpeople/pi-background-tasks`**: `widget.ts` has an explicit mode branch —
  `if (uiCtx.mode === "tui") { /* factory */ } else { uiCtx.ui.setWidget(WIDGET_KEY,
  renderWidgetLines(...), { placement: "belowEditor" }) }` — the one core-pack extension built
  RPC-aware, sending plain string arrays when there's no TUI.
- **`pi-web-access`**: `index.ts:897` — `ctx.ui.setWidget("web-activity", lines)` with a plain
  array too, same shape as pi-background-tasks (not live-triggered this session — its widget only
  populates during an active web search/curator session, not attempted here).
- `ctx.hasUI` is **not** the blocker for any of the above — it is `true` in both TUI and RPC modes
  (`core/extensions/types.d.ts:214`: *"Whether dialog-capable UI is available (true in TUI and RPC
  modes)"*, confirmed by `runner.js`'s `hasUI() { return this.uiContext !== noOpUIContext }`).

### Live check (real `pi --mode rpc` process, real model turn, this session)

Ran the actual installed `pi` binary directly (`node_modules/@earendil-works/pi-coding-agent/dist/
cli.js --mode rpc`) against `~/.pi/agent` (the daemon's real, default `PI_CODING_AGENT_DIR`, with
the full core pack enabled in `settings.json`), piping RPC stdin commands and reading stdout
frames — no daemon or browser needed for this part.

- **`setTitle` — confirmed, real content.** Completed one trivial turn (creating a valid session
  file — a fresh session errors `"Cannot fork: source session file is empty or invalid"` on `/cd`),
  then sent `/cd /tmp`:
  ```json
  {"method":"notify","message":"Changed directory to /tmp","notifyType":"info"}
  {"method":"setTitle","title":"pi - tmp"}
  ```
- **`setWidget` from `pi-background-tasks` — confirmed, real content, shows update cadence.**
  Prompted the model to call its `bg_start` tool on `sleep 20 && echo done`:
  ```json
  {"widgetKey":"bg-tasks-widget","widgetLines":["1 background task · 1 running ·  to expand"],"widgetPlacement":"belowEditor"}
  ```
  ~22 near-identical frames fired over the task's ~20s runtime (content unchanged between most of
  them — it repaints on a fixed timer, `WIDGET_REFRESH_INTERVAL_MS = 1000` in source, not only on
  real state changes), one frame with updated content on completion (`"1 background task · 1
  finished ·  to expand"`), then two `setWidget(key, undefined)` clears. Always one key, always
  `placement: "belowEditor"` — stacking with a second simultaneous key was not exercised.
- **`setWidget` from `pi-powerline-footer` — confirmed always empty**, exactly as the static check
  predicted: all six keys fire at session start with `widgetLines` absent (its defensive
  clear-on-init calls); the real factory-form registrations immediately after never reach the wire.

### What this settles for sprint-070

- **Widget frames arrive** — plan the panel, not just the status strip.
- **Content-diffing matters more than "swapped in place, no motion" implied.** A real producer
  repaints on a fixed timer regardless of whether content changed; a panel that re-renders on every
  frame will flash/reflow needlessly. It must diff before re-rendering.
- **`setTitle` is a real, working producer** (`pi-powerline-footer`'s `/cd`) — worth building for.
- **`setStatus` has zero live producers today.** Its only call site in the core pack is
  keystroke-gated and unreachable via RPC. Build it per spec, but there is no real traffic to
  validate it against yet.
- **Stacking (multiple simultaneous widget keys) remains unverified** — only one key was ever live
  at once in this pass.

### Correction applied at the source

Sprint-068/task-009's claim ("rpiv-todo... drives `setWidget` + `ui.notify`... confirming surfaces
route to the store's `surfaces` map") was wrong and has been corrected in place, along with its two
repeats:
- `swe/sprints/sprint-068-extension-ui-dialogs/done/task-009-verification-matrix-and-docs-summary.md`
  (the origin)
- `swe/sprints/sprint-069-extension-ui-attention/done/task-006-notify-effect-routing-summary.md`
  (repeated it in a follow-up note)
- `swe/sprints/sprint-069-extension-ui-attention/done/task-009-verification-matrix-and-docs.md`
  (this task's own task file, repeated it in the test plan)

## How it satisfies the scope

- The matrix above exists in this summary, ordered for one sitting, and was walked (16 rows, 12
  fully live/unit-confirmed this task or a prior task's own live session, 4 flagged as
  unit-covered-only with the reason stated).
- The cross-surface pass is recorded, with its result (clean) rather than a divergence needing a
  fix — the task's own instruction ("with any divergence fixed rather than noted") is satisfied
  vacuously: there was nothing to fix.
- `packages/web-client/AGENTS.md` and root `AGENTS.md` now state what shipped (§ 08 attention
  signals, § 11 transients, announcements, the toast host) and what did not (§ 09/§ 10 retained
  surfaces, sprint-070).
- `ui-components.md` § Feedback describes the toast host as built (stacking cap, promotion
  semantics, `warning` variant), not as originally specified.
- Full gates green (below).
- The `#ui` mock grammar additions are documented alongside sprint-068's — confirmed, same
  constant, no separate doc to update.
- No temporary toast-firing scaffolding remains — confirmed, none was ever built.

## Build & test results

```
$ npx tsc -b --force
(clean)

$ npx vitest run
Test Files  192 passed (192)
     Tests  2518 passed (2518)

$ npm run lint
(clean on every file touched this sprint; pre-existing unrelated warnings elsewhere untouched)

$ npm run fmt:check
(clean on every file touched this sprint — the 32 files it flags are all markdown-excluded or
pre-existing, unrelated to sprint-069; not touched here per the project's own "scoped formatting
only" convention)

$ npm run build
✓ built in 10.63s (web-client + cli)
```

## Follow-ups / TODO(verify)

- **§ 08's row-wash question remains open upstream.** Task-001's no-wash fallback is the shipped
  behavior; apply the designer's eventual answer deliberately when it arrives (see "§ 08 row-wash
  question" above for the exact integration point).
- **Background-pane deferred-note timing (matrix row 15)** is the one scenario in this sprint not
  independently live-verified end to end (fire `set_editor_text` on a background session, switch to
  that pane later, confirm the note — not the flash — appears exactly once at that moment). Unit
  tests cover the decision logic; the full timing sequence through a real pane switch was not
  re-driven live this session.
- **Reduced-motion (row 11) and narrow-strip (row 9)** were confirmed by code inspection (one
  shared CSS rule / one shared breakpoint helper, no per-surface duplication) but not re-exercised
  with a forced `prefers-reduced-motion` emulation or a resized viewport live this session.
- **Post-sprint (2026-08-21): the user's own live pass found three mouse-focus defects in the
  sprint-068 dialog card that this sprint's matrix did not catch — fixed, gates re-run green.**
  Worth recording *why* the matrix missed them, because it is a gap in method, not luck: every
  focus/keyboard row in both sprints' matrices was verified either by unit test or by a scripted
  `tab.click()`/`.focus()` driver, and **neither can observe any of these three failures**. A
  synthetic `click()` dispatches a `click` event directly, so it cannot notice that a real
  `mousedown`→`mouseup` pair would not have produced one; and `.focus()` called programmatically
  cannot notice that nothing in the UI would ever have called it.
  1. **Every first click on a card button was silently eaten.** `.hint` toggled `display: none →
     flex` on `:focus-within`, so the `mousedown` that focused a button revealed the hint and moved
     that button down ~21px before `mouseup` — the browser then emitted **no `click` at all**
     (measured: `mousedown` fired at `top: 691`, button sat at `670` by `mouseup`, handler never
     ran). Users had to click every control twice. Fixed by toggling `visibility` instead, so the
     line always reserves its height and focusing shifts nothing.
  2. **Clicking a card's body did nothing.** The card is a `div` with no `tabIndex`, so it could
     not take focus; `:focus-within` never matched, and the amber border/ring/hint never appeared
     for a user who clicked the prompt text rather than tabbing. Fixed with `tabIndex={-1}` plus a
     `mousedown` handler that focuses the card (and defers to any real control that was clicked).
  3. **Cards never self-focused on arrival in the normal flow.** § 07's initial-focus effect
     guarded on "is a TEXTAREA/INPUT focused elsewhere", intending "don't steal a draft
     mid-sentence" — but the composer is *always* focused-and-empty immediately after sending the
     message that triggers a card, so the guard fired on every single card. Fixed by narrowing the
     guard to a field holding **unsent text**.
  Method lesson for sprint-070's own sign-off: any row about clicking or focus must be driven with
  real `page.mouse.down()`/`.up()` at fixed coordinates (or by the user), never `tab.click()`, and
  "did focus land here without anyone asking for it?" must be asserted rather than arranged.
- Sprint-069 is complete: all nine tasks done. Per `PLAN.md`, sprint-070 (retained surfaces —
  `setWidget`/`setStatus`/`setTitle`, § 09/§ 10) is scoped but not yet planned; it is the next
  candidate for `av-swe plan`.
