# Task 004 — Pane tab strip attention dot

- **Sprint:** sprint-069-extension-ui-attention
- **Status:** backlog
- **Type:** feature
- **Area:** web-client / features/workspace
- **Priority:** P2
- **Estimated size:** S
- **Depends on:** task-001

## Goal
An inactive tab whose session has a pending question shows the shared 8px `statusWarning` dot before
its `×`, with a 6px gap.

## Context / why
The sidebar signal is not sufficient on its own: with split panes, a pending question can sit in a
background **tab** inside a pane the user is looking at, where the sidebar may not even be in view.
The handoff spec already established the pattern ("an unread/attention tab shows a `StatusDot` before
the ×"), and `features/workspace/tab-attention.ts` already exists with `tabAttentionStatus` — this
task feeds it a new source rather than inventing a mechanism.

§ 08 restricts it to **inactive** tabs: the active tab's own card is already on screen, so a dot there
would be redundant noise.

## Scope references
- `swe/UI design/redesign 0.1.0/Extension Dialogs Visual Spec.html` § 08 (Pane tab strip: dot before
  the ×, 6px gap, inactive tabs only, the tight-strip rule, no count and no label)
- `swe/UI design/redesign 0.1.0/Redesign Handoff Spec.dc.html` § 07 (the tab strip and its existing
  attention pattern, including the label-clamp behavior)
- `packages/web-client/src/features/workspace/tab-attention.ts` (`tabAttentionStatus`)
- `packages/web-client/src/features/workspace/TabStrip.tsx`
- `packages/web-client/src/features/agent-ui/agent-ui-store.ts` (sprint-068)

## What to build
- `tab-attention.ts`: needs-input as a source for a tab's attention status, per tab's bound session.
- `TabStrip.tsx`: render the dot before the `×` with a 6px gap on inactive tabs only, using the
  task-002 pulse modifier. No count, no text label — the tab is only a few characters wide.
- Tight-strip rule, in this order: the label ellipsises **first**; only when the strip cannot fit both
  controls does the dot **replace** the `×`, with closing still available from the tab's context menu.
  Neither the dot nor the label may be dropped before the label has ellipsised.
- **The tab context menu § 08 assumes does not exist yet** — verified: `TabStrip.tsx` has no
  per-tab menu (its only menu is the `＋` `NewTabMenu`), and sprint-061's docs task explicitly marked
  "per-tab context menu" *unimplemented* in `features/workspace-ui.md`. Ship a minimal one as part of
  this task: right-click on a tab, single **Close** action, following `SessionContextMenu.tsx`'s
  Radix cursor-anchored pattern (the app's established right-click convention, used by session,
  workspace and file menus). Without it, a dot-replaced `×` makes an inactive tab uncloseable except
  by activating it first — the exact trap the § 08 rule exists to avoid.
- Accessible name on the dot so the state is not carried by colour alone.
- Clears with the question, exactly as the row does.

## Out of scope
- Activating or scrolling to the tab; no navigation behavior.
- Any change to the active tab's appearance.
- Terminal/file tabs — only tabs bound to a session with pending questions can show this.

## Acceptance criteria
- [ ] An inactive tab whose session has a pending question shows the dot before the `×`; the active
      tab does not, even with its own pending question.
- [ ] Narrowing the pane ellipsises the tab label before either control is affected; narrowing
      further replaces the `×` with the dot, and close remains reachable from the context menu.
- [ ] The dot clears when the question resolves.
- [ ] Non-session tabs are unaffected.
- [ ] Screen readers get a name for the dot.
- [ ] No raw px/hex.

## Test / verification plan
- Tests: extend `tab-attention.ts`'s tests — needs-input sourced per tab, active-tab suppression, and
  the tight-strip precedence (label ellipsis before control replacement) if that decision lives in
  logic. Run `npx vitest run packages/web-client/src/features/workspace/`.
- Build/typecheck/lint: `npm run build:web-client`, `npm run typecheck`, `npm run lint`,
  `npx oxfmt <changed files>`.

## Hand-off for visual sign-off (user)
Open two sessions as two tabs in one pane. Raise `#ui confirm` in the **inactive** one: its tab shows
the pulsing dot before the ×; the active tab shows nothing even after you raise a question there too.
Then drag the pane narrow and watch the order of concessions: label ellipsises, then the × gives way
to the dot, with close still available by right-clicking the tab.

`features/workspace-ui.md`'s § Desktop tab strip lists "per-tab context menu" among the
not-yet-implemented items — building it here means updating that doc in the same change (it stops
being aspirational), per the repo's docs-sync rule.

## Notes
The handoff spec calls the old strip's 160px label clamp with `flex-shrink: 0` "the single worst
defect of the current strip", and sprint-061 rebuilt it around soft pills that give space back. Adding
a second fixed-width control to a tab is exactly the pressure that regressed before — verify the strip
still gives space back with dots present on several tabs.
