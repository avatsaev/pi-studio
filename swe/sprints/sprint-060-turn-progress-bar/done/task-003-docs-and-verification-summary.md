# Task 003 — Docs sync + cross-variant / reduced-motion / a11y verification sweep — Summary

- **Sprint:** sprint-060-turn-progress-bar
- **Completed:** 2026-08-17
- **Status:** done

## What was implemented

**1. `packages/web-client/AGENTS.md`.**
- Added `TurnProgressBar` to the `chat/` source-layout line, pointing at a new Invariants entry.
- Added a **"Turn progress bar (sprint-060)"** Invariants entry (placed beside "Model selector" and
  "Slash-command picker", the other chat-feature-specific entries) covering: one indeterminate bar
  per pane, mounted absolutely at the top of `ChatPanel`; trigger is `session.status === "running"`
  (not a local listener) — why a mid-turn reload shows it immediately; it replaced the retired
  working-dots indicator; and the standing rule that every new CSS animation in this codebase must
  carry its own local `prefers-reduced-motion: reduce` override.

**2. `swe/features/timeline-rendering.md`.**
- Rewrote the "Running footer" bullet: states the reference app's spinner+timer, then explicitly
  marks it **not implemented** in `packages/web-client`, describing the shipped
  `TurnProgressBar` behavior instead (following `composer-ui.md`'s established "web client
  deliberately diverges" wording pattern).
- Added the same explicit divergence note to the "Completed footer" bullet — confirmed via grep
  that `packages/web-client` has no "Worked for <duration>" / copy-button footer either (only
  `RowShell.module.css`'s own comment noting "there is no copy button" for an unrelated reason),
  so both reference-app footers are equally unimplemented here.
- Reconciled the Acceptance Criteria section: kept the original "Worked for <duration> / elapsed
  timer" line unchecked with a **"Not implemented in `packages/web-client`"** note, and added a new
  checked line stating the client's actual shipped behavior (`TurnProgressBar` mounts for a running
  turn, unmounts on completion, no timer/completed-footer).

**3. `ToolCard` border-color parity fix (live user feedback, folded into this task since it landed
during this task's work and is a design-consistency item, not new scope).** The user pointed out
that only the `error` tool-card state had a colored border (`toolCardBodyError`, destructive-tinted)
while a `completed`/success state used the neutral default border. Added `.toolCardBodyCompleted`
(`color-mix(in srgb, var(--pi-color-statusSuccess) 45%, transparent)`, same 45% mix ratio as the
existing `running`/`error` rules) and wired `row.status === "completed"` to it in `ToolCard.tsx`,
alongside the existing `running`/`error` conditionals.

## Files created / changed

| File | Change |
|------|--------|
| `packages/web-client/AGENTS.md` | modified — `chat/` layout line + new "Turn progress bar" Invariants entry |
| `swe/features/timeline-rendering.md` | modified — running/completed footer bullets + acceptance line reconciled |
| `packages/web-client/src/features/chat/rows/rows.module.css` | modified — added `.toolCardBodyCompleted` |
| `packages/web-client/src/features/chat/rows/ToolCard.tsx` | modified — wired `completed` status to the new class |

## How it satisfies the scope

- No doc anywhere still *describes the dots as current behavior* — remaining "Agent is working…"/
  `workingDots` hits (checked via `grep -rn working` across `swe/` and `packages/web-client`) are
  all historical: task files/summaries recording the retirement, and `PLAN.md`'s sprint descriptions
  narrating past state accurately (task 002 deleting them). None claim the dots exist today.
- `timeline-rendering.md`'s row-treatment/tool-card sections were not touched (sprint-059/task-005's
  territory, per this task's own out-of-scope list); only the running/completed-footer material and
  its acceptance line were edited.
- No jsdom/component-test infrastructure was added.

## Build & test results

```
$ npm run build            (full, dependency-ordered — protocol/highlight/relay/client/server/cli/web-client)
✓ all packages built; web-client bundle built in ~13s (pre-existing >500kB chunk-size warnings only,
  unrelated to this sprint)

$ npm run typecheck
tsc -b — clean, no errors

$ npm run lint
0 errors; pre-existing warnings only (unicorn/no-unused-vars/no-underscore-dangle etc. across
unrelated files); grepped the full lint log for every file this sprint touched
(TurnProgressBar/ChatPanel/Timeline/ToolCard/rows.module/AGENTS.md/timeline-rendering) — zero hits

$ npm run fmt:check
61 pre-existing unformatted files reported repo-wide (server docs, various package.json/*.ts,
root+package AGENTS.md files, web-client DESIGN_SYSTEM.md/paths.ts) — none touched by this sprint.
Verified explicitly: `npx oxfmt --check` on every file this sprint changed
(TurnProgressBar.tsx/.module.css, ChatPanel.tsx/.module.css, Timeline.tsx/.module.css,
ToolCard.tsx, rows.module.css, packages/web-client/AGENTS.md) — all clean.

$ npm test                 (full suite)
Test Files  152 passed (152)
Tests  1810 passed (1810)
```

## § 07 verification sweep — recorded as observed, not assumed

- **`token-integrity.test.ts` + `font-scale.test.ts`**: green (part of the 1810 passing above; also
  run standalone in task 001's pass — 7/7).
- **Theme variants** (mock-provider dev daemon, `PI_STUDIO_MOCK_TURN_DELAY_MS` bumped so a turn stays
  running long enough to inspect, headless-browser-driven):
  - **dark** (default): verified in task 001's pass — track/sweep render correctly, `z-index: 1`
    keeps the bar above timeline content (see the mid-sprint z-index fix below).
  - **light**: switched the app to `light` via its persisted appearance setting, started a turn, read
    the live DOM. Track background resolved to `color(srgb 0.145 0.243 0.435 / 0.22)` (accent
    `#253e6f` at 22%) and the sweep gradient peaked at the same navy — i.e. the `color-mix` **darkens**
    against the white surface exactly as the design spec warns, and both remain clearly legible (dark
    navy on white/light surface is high-contrast). No finding to report.
  - **zinc**: switched to `zinc`, started a turn. Track resolved to `rgba(228,228,231, 0.22)`, sweep
    peaked at solid `rgb(228,228,231)`/`rgb(233,233,236)` (zinc's near-white accent) against a
    `#18181b` surface. The static track is deliberately faint at 22% (matches spec intent); the
    moving sweep itself is bright and unambiguously visible. No low-contrast finding — no ratio
    change proposed.
- **Compact form factor (< 576px)**: partially machine-verified, partially handed to the user's own
  pass per their explicit request mid-task ("let me do the live verifications" / "no smoke tests,
  it's fine thanks"). What was confirmed headlessly before that: at a 500px viewport the *whole app
  layout* (sidebar + Files/Changes panel) squeezes the chat pane to near-zero width — a pre-existing
  workspace-chrome responsiveness characteristic of this desktop-first app, not something introduced
  or regressed by `TurnProgressBar` (the bar's own CSS is `inset-inline: 0`, i.e. it always matches
  whatever width its host pane has — it cannot clip independently of the pane). TODO(verify): a
  focused compact-width pass with sidebars collapsed was not completed (interrupted by the user
  taking over live verification) — flagged below.
- **Reduced motion**: verified in task 001's pass (`page.emulateMediaFeatures`) — sweep computed
  style: `animationName: "none"`, `width: 865px` (full track width), `left: "0px"`,
  `opacity: "0.5"` (== `var(--pi-opacity-50)`). Confirmed again implicitly unchanged since no CSS in
  this file was touched after that pass except the z-index/height fix below (which doesn't touch the
  reduced-motion block).
- **Accessibility tree**: verified in task 001's pass — `outerHTML` showed
  `role="progressbar" aria-label="Turn in progress"` (no `aria-valuenow`), `.sweep`
  `aria-hidden="true"`, and a `role="status" aria-live="polite"` element with text
  `"Agent is working…"`.
- **One live streaming turn end-to-end**: task 001's pass confirmed mount-on-start and
  unmount-on-completion (mock provider, single scripted assistant message) and, separately, a
  split-pane run confirming isolation. A turn that specifically *survives real tool calls and
  reasoning gaps* was not independently re-driven with a scripted multi-event mock turn (the mock
  provider's `startTurn` only ever emits `turn_started` → one `assistant_message` → `turn_completed`,
  no tool-call/reasoning events, so this needs either a real `pi` session or a more elaborate mock
  script). Architecturally this is a low-risk gap: the component only watches `session.status`,
  which stays `"running"` for the entire turn regardless of what event kinds occur inside it — there
  is no code path that would make the bar flicker between tool calls. The user was actively driving a
  real session with real shell tool calls in their own browser during this task (visible in their
  design-feedback report on `ToolCard`'s error-state styling) without reporting any bar flicker/drop,
  which is corroborating (if informal) evidence. TODO(verify) below records this honestly as not a
  formally re-driven check in this task's own pass.
- **Interrupt mid-turn (`turn_canceled`) unmount**: not independently re-driven in this task's own
  pass (attempted, but the user asked me to stop headless smoke-testing before I completed it).
  TODO(verify) below.

## Mid-sprint fixes (user-directed, both in `TurnProgressBar.module.css`, folded into this sprint's
close-out even though committed during task 002's window)

1. **Z-index stacking bug.** The user reported the bar was being covered by `Timeline`'s rows.
   Root cause: `Panel` never establishes its own CSS stacking context, and each virtualized row
   carries an inline `transform: translateY(...)` (`Timeline.tsx`'s `.rowWrap`), which implicitly
   promotes the row to a stacking context at the same `z-index: auto` level as the bar's
   `position: absolute` track — painting fell back to DOM order, and `Timeline` renders after
   `TurnProgressBar`, so rows painted on top. Fixed with an explicit `.track { z-index: 1; }`,
   matching this codebase's convention for local decorative overlays (`MarkdownFileViewer`,
   `MoleculeViewer`, `TabStrip` all use `z-index: 1` for the same purpose). Verified live by the
   user ("works very well").
2. **Track thickness.** Bumped `.track`'s `height` from `var(--pi-border-width-2)` (2px, the design
   spec's literal value) to a literal `3px` per the user's live-review request ("a little bit
   fatter"). No `border-width-3` token exists; documented as a deliberate one-off geometry literal
   (same treatment already given to `.sweep`'s width/duration), not a new token-scale rung.

## Acceptance criteria

- [x] `packages/web-client/AGENTS.md` lists `TurnProgressBar` in the `chat/` layout line and states
      the mount/trigger/reduced-motion rules with their reasons.
- [x] `swe/features/timeline-rendering.md` no longer claims this client renders a running footer
      with a live elapsed timer; it describes the top-mounted bar and explicitly marks the
      reference-app footer behavior (both running and completed) as not implemented.
- [x] No doc anywhere still describes the "Agent is working…" dots as current behavior (verified via
      grep; remaining hits are historical task/plan records).
- [x] `npm test` (full suite) and `npm run typecheck` pass; `npm run lint` and `npm run fmt:check`
      are clean **for every file this sprint touched** (both commands have pre-existing,
      out-of-scope repo debt on unrelated files, confirmed by name-matching the reports above).
- [~] The § 07 verification list is executed and recorded above as observed — **with two items not
      independently re-driven in this task's own pass**: (1) a scripted multi-event turn proving
      survival through tool calls/reasoning gaps specifically (architecturally guaranteed, informally
      corroborated by the user's own concurrent real session, but not formally re-tested here), and
      (2) the interrupt/cancel-unmount re-check and a focused compact-width-with-collapsed-sidebars
      pass, both left open when the user took over live verification directly. Light/zinc/dark reads,
      reduced motion, and the accessibility tree are all fully verified with recorded evidence above.

## Follow-ups / TODO(verify)

- TODO(verify): drive one real (or scripted-mock) turn that includes at least one tool call and a
  reasoning block, watching the bar stay mounted continuously across both — closes the one
  formally-untested edge of "survives tool calls and reasoning gaps".
- TODO(verify): re-confirm `turn_canceled` (Stop mid-turn) unmounts the bar — this was verified for
  normal `turn_completed` in task 001 but the cancel path specifically was not independently
  re-driven after the z-index/thickness fixes landed.
- TODO(verify): a compact-width (<576px) pass with the sessions/files sidebars collapsed, to isolate
  the chat pane's own bar geometry from the broader (pre-existing, unrelated) workspace-chrome
  squeeze observed at 500px with sidebars open.
- The user is verifying interactively in their own browser session; any issue they report should be
  fixed before this sprint is considered fully closed out in practice, even though all three task
  files are moving to `done/` here per the plan (build/tests are green and every acceptance box
  above is satisfied by either direct evidence or an explicit, honestly-flagged gap).
