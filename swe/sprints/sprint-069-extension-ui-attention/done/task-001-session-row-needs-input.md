# Task 001 — Session row carries the needs-input signal

- **Sprint:** sprint-069-extension-ui-attention
- **Status:** done
- **Type:** feature
- **Area:** web-client / features/sessions, ui
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** none

## Goal
A session with a pending extension question shows it in the sidebar: the row's status line becomes an
8px `statusWarning` `StatusDot` plus the label **needs input**, with a 2px `statusWarning` left accent
bar on the row.

## Context / why
Sprint-068 renders question cards, but only inside the session you are looking at. A dialog raised in
any other session is invisible and the agent sits blocked — the single largest gap that sprint left
open, and the reason this sprint exists.

The sidebar is already built for this. `ui/status-dot.ts` maps `waiting` to `statusWarning`, exports
`STATUS_DOT_SIZE = 8` (which § 08 adopts, correcting rev 1's 7px), and `StatusDotInput` already
carries `requiresAttention`/`attentionReason`. `session-presentation.ts`'s `workspaceAttentionDot`
even documents the gap in a comment — needs-input is "unsourceable in this client", with `error` the
only real attention signal available. Sprint-068's store is what makes it sourceable.

Two vocabulary problems to settle here rather than paper over: `AttentionReason` is
`"finished" | "error" | "permission"` — no `"question"` member, and `"permission"` (which
`features/extension-ui-rpc.md` argues at length is a *different* concept) must not be reused for it —
and `pendingPermissionCount` is permission-named for what is now a more general count.

## Scope references
- `swe/UI design/redesign 0.1.0/Extension Dialogs Visual Spec.html` § 08 (Session row, Row fill,
  Clearing, Never colour alone), § 01 (`statusWarning` opacity steps), § 13 (reduced motion)
- `swe/UI design/redesign 0.1.0/Redesign Handoff Spec.dc.html` § 03 (the sidebar this reconciles
  with — the "needs input" text label and the failed-row tint convention)
- `packages/web-client/src/ui/status-dot.ts` (`StatusDotInput`, `statusDotColor`, `STATUS_DOT_SIZE`,
  the `waiting` status)
- `packages/web-client/src/components/primitives/StatusDot.tsx` + `StatusDot.module.css`
- `packages/web-client/src/features/sessions/session-presentation.ts` (`sidebarSessionView`,
  `toDotStatus`, `workspaceAttentionDot` and its "needs-input unsourceable" comment)
- `packages/web-client/src/features/sessions/SessionItem.tsx`
- `packages/web-client/src/features/agent-ui/agent-ui-store.ts` (sprint-068: `useAgentUiPending`,
  per-agent pending counts)

## What to build
- Extend the status-dot vocabulary: add a `"question"` member to `attentionReason` and give the count
  field a method-neutral name, migrating existing callers. Do **not** reuse `"permission"` — the two
  concepts are deliberately distinct and conflating them here would make a future tool-permission
  surface unable to tell them apart.
- `session-presentation.ts`: source needs-input from the sprint-068 store and make it **win over
  running** — per § 08 the dot takes the slot from a running spinner while a question is pending. The
  session name above is untouched.
- `SessionItem.tsx`: status line renders the 8px `statusWarning` dot + `needs input` label in the same
  colour, replacing whatever status text was there.
- Row treatment: 2px `statusWarning` left accent bar. When the row is also the selected row, the
  selection tint wins and the accent bar still shows.
- Clearing: dot and label disappear together the moment nothing is pending — answered, dismissed,
  expired or no-longer-pending alike. Opening the session does **not** clear them on its own.
- One signal per row regardless of how many questions are pending on that session.

## Out of scope
- The pulse (task-002), workspace header (task-003), tab strip (task-004) — each lands on this task's
  foundation.
- Announcements (task-008).
- Toasts and composer effects (tasks 005–007).

## Acceptance criteria
- [ ] A question pending in a **non-active** session shows the dot + `needs input` on that session's
      row while the user is elsewhere.
- [ ] A running session with a pending question shows needs-input, not the running spinner.
- [ ] Answering, dismissing, or letting the question expire clears the row signal; merely opening the
      session does not.
- [ ] Two pending questions on one session render one signal, not two.
- [ ] The selected row keeps its selection tint and still shows the accent bar.
- [ ] `attentionReason: "question"` is distinct from `"permission"`; no existing caller changed
      behavior.
- [ ] With no `extensionUi` capability, the sidebar is byte-for-byte today's.
- [ ] All CSS from tokens; no raw px/hex.

## Test / verification plan
- Tests: extend `session-presentation`'s existing test coverage — needs-input beats running, clears on
  resolution, one-per-row, capability-off yields today's view. Extend `status-dot.ts`'s tests for the
  new reason. Run `npx vitest run packages/web-client/src/features/sessions/ packages/web-client/src/ui/`.
- Build/typecheck/lint: `npm run build:web-client`, `npm run typecheck`, `npm run lint`,
  `npx oxfmt <changed files>`.

## Hand-off for visual sign-off (user)
Dev daemon, mock provider. Open session A, then raise a question in session B (`#ui select` in B, then
switch to A): B's row shows the dot + `needs input` while you are in A. Answer it from B and confirm
the row returns to its normal status. Also check a **running** session with a pending question — the
spinner must give way to needs-input.

## Notes
**§ 08 contradicts itself on the row wash**, filed by sprint-068/task-009 as correction 1 in
`swe/UI design/redesign 0.1.0/spec-corrections.md` (unanswered as of sprint-068's close,
2026-08-21): the section banner says "no row tint for needs-input (tints stay reserved for the
failed state)" and § 01 disclaims a session-row tint, but § 08's own `Row fill` entry specifies a
`statusWarning` 10% wash. If the corrections doc carries the designer's answer by the time this
task runs, follow it. If not, ship the accent
bar **without** the wash — that is what the banner and § 01 both promise — and record the decision so
the sprint does not stall on a one-line question.
