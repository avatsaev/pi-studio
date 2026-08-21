# Task 001 — Session row carries the needs-input signal — Summary

- **Sprint:** sprint-069-extension-ui-attention
- **Completed:** 2026-08-21
- **Status:** done

## What was implemented

A session with at least one pending extension question now shows it on its sidebar row, sourced
from sprint-068's `useAgentUiPending` store: the meta line becomes an 8px `statusWarning` dot +
"needs input" label (same color), and the row gets a 2px `statusWarning` left accent bar that does
**not** yield to selection (unlike the failed-turn wash, which does).

Two vocabulary changes land in `status-dot.ts`: `AttentionReason` gains a `"question"` member
(kept distinct from `"permission"` — both currently map to `statusWarning`, but are separate enum
values so a future divergence doesn't require touching every color-only caller), and
`pendingPermissionCount` is renamed to the method-neutral `pendingCount` (it had zero existing
callers, so this was a pure rename, not a migration).

`sidebarSessionView` gained a second parameter, `hasPendingQuestion: boolean`, sourced by
`SessionItem.tsx` (the one place this "pure, store-free" module's caller reaches into
`useAgentUiPending`). Precedence, checked in this order: `error` status → `failed` (unchanged) →
pending question → `needsInput` (wins over `running`, per § 08: "the dot takes the slot from a
running spinner while a question is pending") → existing running/empty/idle logic. A running
session's `dot.status` stays `"running"` but `requiresAttention: true` suppresses `StatusDot.tsx`'s
spinner in favor of the flat warning dot — that suppression already existed in `StatusDot.tsx`,
unused until this task's `requiresAttention`/`attentionReason` values.

Per spec correction 1 (`swe/UI design/redesign 0.1.0/spec-corrections.md`, filed by
sprint-068/task-009, still unanswered at this task's start): § 08's own "Row fill" entry
contradicts its own banner and § 01 on whether the row background gets a `statusWarning` 10% wash.
Shipped **without** the wash (accent bar only), per the banner/§ 01 fallback the task's Notes
section specified; the corrections file's designer answer, if it arrives, should be applied
deliberately rather than guessed here.

## Files created / changed

| File | Change |
|------|--------|
| `packages/web-client/src/ui/status-dot.ts` | modified — `"question"` reason, `pendingCount` rename |
| `packages/web-client/src/ui/status-dot.test.ts` | created — first test coverage for this module |
| `packages/web-client/src/features/sessions/session-presentation.ts` | modified — `sidebarSessionView(session, hasPendingQuestion)`, `needsInput` state |
| `packages/web-client/src/features/sessions/session-presentation.test.ts` | modified — updated call sites, added needs-input coverage |
| `packages/web-client/src/features/sessions/SessionItem.tsx` | modified — sources `useAgentUiPending`, renders the accent bar + colored label |
| `packages/web-client/src/features/sessions/SessionList.module.css` | modified — `.activeBarNeedsInput`, `.metaNeedsInput` |

## How it satisfies the scope

Maps directly to § 08's Session row / Row fill / Clearing / Never colour alone subsections and §
01's `statusWarning` token usage, as described in the task's Scope references. `workspaceAttentionDot`
and the tab strip are untouched — out of scope here, sourced by tasks 003–004 on this task's
`needsInput` foundation. The pulse animation is task-002's — this task wires the state, not the
motion.

## Build & test results

```
$ npx vitest run packages/web-client/src/features/sessions/ packages/web-client/src/ui/
 ✓ packages/web-client/src/ui/status-dot.test.ts (7 tests)
 ✓ packages/web-client/src/features/sessions/workspace-grouping.test.ts (3 tests)
 ✓ packages/web-client/src/features/sessions/session-presentation.test.ts (27 tests)
 Test Files  3 passed (3)
 Tests  37 passed (37)

$ npx tsc -b --force
(clean — no output)

$ npm run lint
(pre-existing warnings only, in unrelated files; zero on any file touched by this task)

$ npx oxfmt --check <changed files>
All matched files use the correct format.

$ npm run build:web-client
✓ built in 10.34s
```

## Acceptance criteria

- [x] A question pending in a non-active session shows the dot + `needs input` on that session's
      row while the user is elsewhere — `useAgentUiPending(session.agentId)` is read per row,
      independent of which session is active.
- [x] A running session with a pending question shows needs-input, not the running spinner —
      `sidebarState` checks `hasPendingQuestion` before `running`; `requiresAttention` suppresses
      `StatusDot.tsx`'s spinner condition.
- [x] Answering, dismissing, or letting the question expire clears the row signal; merely opening
      the session does not — driven entirely by the store's pending array; opening a session issues
      no respond/dismiss RPC.
- [x] Two pending questions on one session render one signal, not two — `hasPendingQuestion` is a
      boolean (`pending.length > 0`), not a count; `sidebarSessionView`'s type signature makes a
      double-signal impossible.
- [x] The selected row keeps its selection tint and still shows the accent bar — `.activeBarNeedsInput`
      overrides only the bar's background color, never suppressed by `.item.active`.
- [x] `attentionReason: "question"` is distinct from `"permission"`; no existing caller changed
      behavior — confirmed via repo-wide grep: zero existing callers set `requiresAttention` or
      `attentionReason` before this task.
- [x] With no `extensionUi` capability, the sidebar is byte-for-byte today's — capability-absent
      means no controller is ever created (sprint-068's documented behavior), so
      `useAgentUiPending` always returns the stable `EMPTY_PENDING` array, `hasPendingQuestion` is
      always `false`, and `sidebarSessionView`'s needs-input branch is unreachable.
- [x] All CSS from tokens; no raw px/hex — `var(--pi-color-statusWarning)` throughout; the accent
      bar reuses `.activeBar`'s existing `2px` width.

## Follow-ups / TODO(verify)

- Spec correction 1 (row wash) remains unanswered upstream. If the designer's answer lands before
  task-009 closes the sprint, apply it deliberately (task-009's job per its own scope).
- Manual visual sign-off (dev daemon, mock provider, `#ui select` in a background session) deferred
  to task-009's consolidated matrix, per this sprint's stated hand-off convention.
