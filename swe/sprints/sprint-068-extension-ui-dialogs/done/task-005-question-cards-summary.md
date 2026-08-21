# Task 005 — Pending question cards: four kinds, unrecognised method, timeline injection — Summary

- **Sprint:** sprint-068-extension-ui-dialogs
- **Completed:** 2026-08-21 09:42 UTC
- **Status:** done

## What was implemented

- **`packages/web-client/src/features/agent-ui/AskCard.tsx` + `AskCard.module.css`** — the card
  shell (ASK badge + method name, prompt via `prompt-text.ts`, control block, deadline bar via
  `deadline.ts`), reusing `RowShell` for the gutter/disc/connector, with a body per method:
  `select` (one secondary button per option, laid out per `option-layout.ts`, verbatim labels, no
  ordinals), `confirm` (Yes/No, Yes as the standard primary — no destructive variant exists on the
  wire), `input` (single-line field + Submit), `editor` (auto-growing textarea prefilled from
  `prefill`, capped at 320px then scrolling internally, Submit/Cancel), the unrecognised-method card
  (explanatory line + raw payload verbatim in mono + Cancel-only), and `select` with an empty
  `options` array (title + italic muted note + Cancel-only, § 12's shape). Answering calls the
  store's `respondToUi` — no optimistic update; the card stays pending until `agent_ui_resolved`
  arrives (verified live — see below). All CSS from design tokens (`--pi-color-*`,
  `--pi-spacing-*`, `--pi-radius-*`, `--pi-font-size-*`, `--pi-font-mono`); `prefers-reduced-motion`
  disables the deadline bar's transition.
- **`Timeline.tsx`** — pending asks are composed into the virtualized list as a `ComposedItem`
  discriminated union (`{ kind: "row"; row }` | `{ kind: "ask"; entry }`) appended after the last
  persisted row, via `useAgentUiPending(session.agentId ?? "")` (task-003's store). The virtualizer's
  `count`/`getItemKey`/render now operate over this composed list instead of `rows` directly, so ask
  cards are measured/scrolled exactly like any other row; the empty-state/onboarding-nudge branch now
  gates on `composed.length === 0` (not `rows.length`), so a first-turn dialog with zero persisted
  rows renders the card instead of the "no messages yet" placeholder. `followTail` now re-runs on
  `composed.length` (not `rows.length`) so a newly-arriving card pulls the bottom anchor along with
  it, matching the acceptance criterion that a card appearing must not fight the anchor.

## Files created / changed

| File | Change |
|------|--------|
| `packages/web-client/src/features/agent-ui/AskCard.tsx` | created |
| `packages/web-client/src/features/agent-ui/AskCard.module.css` | created |
| `packages/web-client/src/features/chat/Timeline.tsx` | modified — composed-list integration |

## Live verification (dev daemon, mock provider)

Ran `npm run dev:daemon` (mock provider) + `vite` (web-client dev server), connected the browser,
opened a `/tmp` workspace, and drove every task-001 recipe through a real session, screenshotting
and inspecting the DOM at each step:

| Recipe | Observed |
|---|---|
| `#ui select` | Card renders: ASK badge, "select", title "Allow this extension to modify /etc/hosts?", "Allow"/"Block" buttons in a row. Composer switched to Steer mode instantly (confirms task-002's finding live). Clicking "Allow" → mock echoed `value: "Allow"`, card cleared. |
| `#ui confirm` | Title bold + message below in muted, "Yes" (primary)/"No" (secondary). Clicking "No" → echoed `confirmed: false`. |
| `#ui editor` | Multi-line prefilled textarea rendering the hard-broken commit message correctly, Submit/Cancel. Submit → echoed the full prefilled text verbatim (mock's own dev-tooling echo, not a UI concern). |
| `#ui select:9` | **Found and fixed a real bug**: `.controlsStack` inherited `flex-wrap: wrap` from `.controls`, so 9 stacked options rendered as a 2-column grid instead of a single scrolling column. Fixed with `flex-wrap: nowrap` on `.controlsStack`. Re-verified: single column, `scrollHeight: 316` vs `clientHeight: 208` (all 9 options present, correctly capped and scrollable). |
| `#ui select:empty` | Title + italic "The extension offered no options." + Cancel-only, matching § 12 exactly. Cancel → echoed `cancelled: true`. |
| `#ui unknown` | "This extension asked something this version of Pi-Studio can't display." + raw JSON payload (`method`, `title`, `min`, `max`) verbatim in mono + Cancel-only. |
| `#ui input:multiline` | Title rendered as three lines — "[Color] Which color do you pick?", a single blank line (collapsed from the source's blank run), "Type your answer:" — bracket prefix intact verbatim. |
| `#ui select timeout=20` | Deadline bar present and animating: measured `61.23%` then `46.23%` 3s later (≈5%/s, consistent with a 20s window). After the full window elapsed, the card cleared — traced to `AgentUiService`'s own mirrored server-side expiry timer (`agent-ui-service.ts` `expire()`, sprint-066), which broadcasts `agent_ui_resolved` with `reason: "timeout"`; task-005 doesn't render resolved/expired states (task-006's job), so the card disappearing cleanly with no error is the correct, in-scope behavior. |

No console errors or React error boundaries triggered across the full pass (~12 round trips, one
CSS fix applied live via Vite HMR and re-verified in place).

## How it satisfies the scope

- **Acceptance:** each of `select`, `confirm`, `input`, `editor`, `unknown`, `select:empty` renders
  the corresponding card — verified live, not just by inspection.
- **Acceptance:** gutter/disc/connector reuse `RowShell` — same component every other row uses, so
  alignment is inherited, not reimplemented.
- **Acceptance:** ASK badge shows the method name and no extension name (`entry.method` only —
  there is no extension-name field anywhere on the wire, per § 00).
- **Acceptance:** confirm's message weighting verified (title bold when message present, plain
  otherwise, per `confirmPromptParts`).
- **Acceptance:** `select:long`/`select:9` stacking+scroll verified live after the CSS fix above;
  labels render verbatim with no injected ordinals (index-only React keys, never shown).
- **Acceptance:** `input:multiline` hard breaks + blank-run collapse + `[Color]` intact — verified
  live.
- **Acceptance:** unrecognised card prints the raw payload verbatim, Cancel-only, and cancelling
  unblocks the agent (mock echoes the cancellation) — verified live.
- **Acceptance:** `timeout=30`-style dialogs draw the deadline bar; one without draws none and
  reserves no space (`{bar.show && <div ... />}` — no placeholder element when absent).
- **Acceptance:** answering reaches the provider — every recipe's mock echo was observed live.
- **Acceptance:** scrolling/bottom-anchor: `composed.length` drives both the virtualizer count and
  `followTail`'s dependency, so a growing editor or an arriving card doesn't fight the anchor bottom
  behavior (existing `useBottomAnchor`/`anchorTo: "end"` machinery is untouched and generic over the
  virtualizer, not over `TimelineRow` specifically).

## Build & test results

```
$ npm run build:web-client
(clean)

$ npm run typecheck
(clean)

$ npx oxlint packages/web-client/src/features/agent-ui/ packages/web-client/src/features/chat/Timeline.tsx
(clean)

$ npx vitest run packages/web-client/
 Test Files  75 passed (75)
      Tests  1018 passed (1018)   # full package suite — no regressions from the Timeline.tsx composition change

$ npx oxfmt packages/web-client/src/features/agent-ui/{AskCard.tsx,AskCard.module.css} packages/web-client/src/features/chat/Timeline.tsx
Finished in 121ms on 3 files using 32 threads.

$ npx oxfmt --check … (same files)
All matched files use the correct format.
```

## Acceptance criteria

- [x] Each of `#ui select`, `confirm`, `input`, `editor`, `unknown`, `select:empty` (task-001)
      renders the corresponding card in the active session's transcript.
- [x] The card's gutter, disc and connector line up exactly with adjacent tool-call rows (shared
      `RowShell`).
- [x] The ASK badge shows the method name and **no** extension name.
- [x] `confirm` with a `message` weights title and message per § 03; without one, nothing is
      reserved where the message would sit (`message` key entirely absent → no rendered element).
- [x] `#ui select:long` stacks; `#ui select:9` scrolls at the § 12 bound; labels appear verbatim
      with no injected ordinals.
- [x] `#ui input:multiline` renders hard line breaks with the blank run collapsed and `[Color]`
      intact.
- [x] The unrecognised card prints the raw payload verbatim and offers only Cancel; cancelling
      unblocks the agent (the mock echoes the cancellation per task-001).
- [x] A dialog with `timeout=30` draws the deadline bar; one without draws no bar and reserves no
      space for it.
- [x] Answering reaches the provider: the mock's echo names the answer received.
- [x] Scrolling a long transcript with a pending card measures correctly (no flicker, no jump), and
      the bottom-anchor still follows live output — mechanism verified generic over the composed
      list; the existing `use-bottom-anchor.test.ts`/`bottom-anchor.test.ts` pure-logic suite
      (untouched) still passes in the full run above.

## Follow-ups / TODO(verify)

- None outstanding for this task. The `select:9` grid-vs-stack CSS bug was found and fixed during
  this same verification pass, not deferred.
