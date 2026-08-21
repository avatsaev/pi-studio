# Task 005 — Pending question cards: four kinds, unrecognised method, timeline injection

- **Sprint:** sprint-068-extension-ui-dialogs
- **Status:** backlog
- **Type:** feature
- **Area:** web-client / features/agent-ui, features/chat
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** task-003, task-004

## Goal
Render a pending extension dialog as a card in the chat transcript — `select`, `confirm`, `input`,
`editor`, plus the unrecognised-method card — visually consistent with the existing tool-call row
language, and answerable.

## Goal boundary
Pending state only. Resolution, in-flight, offline and multi-card behavior are tasks 006–007.

## Context / why
This is the first user-visible pixel of a feature whose server and state halves have been shipped for
two sprints. Until it lands, an interactive extension still blocks an agent's turn with nothing on
screen.

The card is not a timeline row in the data model: UI requests are deliberately never persisted to the
transcript, so they cannot come from `session.timeline.rows`. They must be composed into the
virtualized list at render time. The visual spec asks for the card to sit in the transcript's gutter
language regardless (§ 02: same 20px gutter, disc and connector as a tool card), so the shell is
reused, not reinvented.

## Scope references
- `swe/UI design/redesign 0.1.0/Extension Dialogs Visual Spec.html` § 01 (tokens), § 02 (anatomy,
  gutter/disc/connector parity, ASK badge with the method name alone), § 03 (the four kinds,
  including `confirm` with and without `message`), § 05 (unrecognised method: raw payload verbatim,
  Cancel-only, still answerable), § 12 (empty options), § 13 (motion, reduced-motion)
- `packages/web-client/src/features/chat/Timeline.tsx` — the virtualizer over
  `session.timeline.rows`, `renderRow`, `ESTIMATED_ROW_HEIGHT_PX`, `useBottomAnchor`
- `packages/web-client/src/features/chat/rows/RowShell.tsx` + `RowShell.module.css` (gutter, disc,
  connector)
- `packages/web-client/src/features/chat/rows/ToolCard.tsx` + `rows.module.css` (the card language
  § 02 says to match)
- `packages/web-client/src/features/agent-ui/` — task-004's modules, task-003's store
- `packages/web-client/src/components/primitives/Button.tsx` (control conventions)

## What to build
- `packages/web-client/src/features/agent-ui/AskCard.tsx` + `AskCard.module.css` — the card shell
  (ASK badge + method name, prompt via `prompt-text.ts`, control block, deadline bar via
  `deadline.ts`) with a body per method:
  - `select` — one button per option in source order, laid out per `option-layout.ts`. Labels
    verbatim, no ordinals.
  - `confirm` — affirmative/negative controls. No destructive variant exists (§ 03: nothing on the
    wire flags destructiveness), so the affirmative control is the standard primary.
  - `input` — single-line field with `placeholder`, submit control.
  - `editor` — multi-line field prefilled from `prefill`, growing per § 03's bounds.
  - unrecognised method — the § 05 card: our own explanatory line, the raw payload printed verbatim
    in mono, and a Cancel-only control (dropping it would wedge the turn).
  - `select` with an empty `options` array — the § 12 treatment, still cancellable.
- Timeline integration: compose pending cards into the virtualized list **after** the last persisted
  row, as a discriminated union alongside `TimelineRow`, so the virtualizer measures and scrolls them
  like any other row. `anchorTo: "end"` and `useBottomAnchor` must keep behaving: a card appearing
  must not fight the bottom-anchor, and a growing editor must not jump the transcript.
- Answering calls task-003's respond action. **No optimistic update** — the card stays pending until
  the daemon's `agent_ui_resolved` arrives (task-006 renders the in-flight and resolved states; until
  then a submitted card simply remains pending, which is correct, not a gap).
- Cards render only for the session the pane is showing, and only when the store has the capability.
- All CSS from design tokens (`--pi-color-*`, `--pi-spacing-*`, `--pi-font-size-*`); no raw px or hex
  literals. Honour `prefers-reduced-motion` per § 13.

## Out of scope
- In-flight / resolved / offline states, multi-card ordering, the recovered chip (tasks 006–007).
- Keyboard handling and focus (task 008) — this task's controls are mouse-operable; do not add ad-hoc
  key handlers that task-008 would have to unpick.
- Sidebar/tab attention, toasts, surfaces (sprints 069–070). A dialog for a **background** session is
  therefore invisible until the user opens that session; that is the accepted intermediate state for
  this sprint.

## Acceptance criteria
- [ ] Each of `#ui select`, `confirm`, `input`, `editor`, `unknown`, `select:empty` (task-001)
      renders the corresponding card in the active session's transcript.
- [ ] The card's gutter, disc and connector line up exactly with adjacent tool-call rows.
- [ ] The ASK badge shows the method name and **no** extension name.
- [ ] `confirm` with a `message` weights title and message per § 03; without one, nothing is reserved
      where the message would sit.
- [ ] `#ui select:long` stacks; `#ui select:9` scrolls at the § 12 bound; labels appear verbatim with
      no injected ordinals.
- [ ] `#ui input:multiline` renders hard line breaks with the blank run collapsed and `[Color]`
      intact.
- [ ] The unrecognised card prints the raw payload verbatim and offers only Cancel; cancelling
      unblocks the agent (the mock echoes the cancellation per task-001).
- [ ] A dialog with `timeout=30` draws the deadline bar; one without draws no bar and reserves no
      space for it.
- [ ] Answering reaches the provider: the mock's echo names the answer received.
- [ ] Scrolling a long transcript with a pending card measures correctly (no flicker, no jump), and
      the bottom-anchor still follows live output.

## Test / verification plan
- Tests: none new for the components themselves (no jsdom by convention — the decisions are already
  tested in task-004). If timeline composition needs logic beyond a concatenation — ordering,
  keying, measurement hints — extract it to a pure module with a colocated test rather than burying
  it in the component.
- Build/typecheck/lint: `npm run build:web-client`, `npm run typecheck`, `npm run lint`,
  `npx oxfmt <changed files>`.

## Hand-off for visual sign-off (user)
Dev daemon with the mock provider. In one session, run each recipe in turn and compare against the
spec's mocks side by side: `#ui select`, `#ui select:long`, `#ui select:9`, `#ui select:empty`,
`#ui confirm`, `#ui input`, `#ui input:multiline`, `#ui editor`, `#ui unknown`,
`#ui select timeout=30`. Answer some, cancel others; the mock echoes what it received so the round
trip is visible. Also worth one pass against a real `pi` with
`@juicesharp/rpiv-ask-user-question` — its payloads are the ones § 03's rules were derived from.

## Notes
The card must not enter the persisted transcript in any form. If a future refactor makes it tempting
to synthesise a `TimelineRow` for one, that would put a question into the append-only timeline the
server deliberately keeps it out of.
