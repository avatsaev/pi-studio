# Task 003 — Collapsed workspace header carries the signal — Summary

- **Sprint:** sprint-069-extension-ui-attention
- **Completed:** 2026-08-21
- **Status:** done

## What was implemented

`workspaceAttentionDot` now sources needs-input from sprint-068's store (aggregated across a
workspace group's sessions) in addition to its existing failure signal, and returns a richer
`WorkspaceAttentionInfo` (`{ dot, reason: "question" | "failed", pendingSessionCount }`) instead of
a bare `StatusDotInput` — the extra fields are what let `WorkspaceGroupHeader.tsx` build the § 08
accessible name without reaching into the store itself.

**Precedence decision (recorded per the task's requirement):** a pending question wins over a
failed session. Rationale: a failed turn is already over — nothing time-sensitive is happening, and
the user can review it whenever — while a pending question means an agent is actively blocked on
the user *right now*. The more urgent state gets the collapsed group's one dot. (This is the
opposite precedence from task-001's single-session row, where `error` status wins over a pending
question — reasonable there too, since a row's `error` status generally means the SDK isn't
expecting further per-session input on that exact turn, and the two states rarely co-occur on one
session; the workspace aggregate is different because the two states can genuinely come from two
different sibling sessions in the same group, and are not mutually exclusive the way a single
session's own state is.)

Two new plumbing pieces support this:
- `agent-ui-store.ts` gained `useAgentUiPendingAgentIds()` (+ its testable `selectAgentUiPendingAgentIds`
  core), built on `@av-pi-studio/client`'s existing `pendingByAgent` selector and cached the same
  "stable reference for equal content" way `stableList` already does for the per-agent arrays —
  needed because a group's session list can't call `useAgentUiPending` once per session (a
  variable-length hook loop), so the header instead needs one whole-store subscription giving back
  the full set of agent ids with a pending question.
- `StatusDot` gained an `"aria-label"` prop: when set, the dot switches from `role="presentation"`
  (today's decorative default, unchanged for every existing caller) to `role="img"` with that name
  — the general mechanism for § 08's "no dot is ever colour-only" rule, reusable by task-004's tab
  dot.

`WorkspaceGroupHeader.tsx` renders the dot only while collapsed (unchanged gating, already existed),
positioned between the workspace label and the count pill (unchanged position), now opted into
task-002's `pulse` modifier only for `reason === "question"`, with the accessible name built from
its own `label` prop: `"<workspace> — N session(s) needs input"` for the question case (§ 08's exact
form, correct singular/plural), or `"<workspace> — turn failed"` for the failure case (§ 08 doesn't
give exact wording for this case; kept consistent with the row's existing "turn failed" text). The
count pill (`.workspaceCount`) is untouched — still neutral grey in every case, since this task never
modified it.

## Files created / changed

| File | Change |
|------|--------|
| `packages/web-client/src/features/agent-ui/agent-ui-store.ts` | modified — `useAgentUiPendingAgentIds` hook + selector |
| `packages/web-client/src/features/sessions/session-presentation.ts` | modified — `WorkspaceAttentionInfo`, `workspaceAttentionDot` signature/precedence |
| `packages/web-client/src/features/sessions/session-presentation.test.ts` | modified — updated + new `workspaceAttentionDot` coverage |
| `packages/web-client/src/features/sessions/WorkspaceGroupHeader.tsx` | modified — consumes `WorkspaceAttentionInfo`, builds accessible name, wires `pulse` |
| `packages/web-client/src/features/sessions/SessionList.tsx` | modified — sources `useAgentUiPendingAgentIds`, passes it through |
| `packages/web-client/src/components/primitives/StatusDot.tsx` | modified — `"aria-label"` prop, conditional `role` |

## How it satisfies the scope

Matches § 08's Workspace header subsection (collapsed only, placement after the name/before the
pill, accessible name form, pill stays neutral grey) and § 03's collapsed-only attention dot. The
divergence rev 1 raised (expanded-or-collapsed plus an inset glow) is not present — this task, like
the pre-existing code, keeps § 08/handoff-spec's collapsed-only, no-glow behavior; expanding a group
still shows nothing, deferring to the rows underneath.

## Build & test results

```
$ npx tsc -b --force
(clean — no output)

$ npm run build:web-client
✓ built in 10.32s

$ npm run lint
(zero warnings on any file touched by this task)

$ npx oxfmt --check <changed files>
All matched files use the correct format.

$ npx vitest run packages/web-client/src/features/sessions/ packages/web-client/src/ui/ packages/web-client/src/features/agent-ui/
Test Files  11 passed (11)
Tests  124 passed (124)
```

## Acceptance criteria

- [x] Collapsing a group containing a pending question shows the dot between name and pill;
      expanding it hides the dot and the rows show the signal instead — gating logic unchanged
      (`collapsed ? workspaceAttentionDot(...) : null`), only the info it renders is new.
- [x] Two sessions pending in one collapsed group still show one dot, and the accessible name
      reports the correct count and plural form — `pendingSessionCount` counts sessions, not
      questions; tested for 1 and 2.
- [x] Resolving the last pending question in a collapsed group clears the dot — `pendingAgentIds`
      losing the last member and no failures present ⇒ `workspaceAttentionDot` returns `null`
      (tested).
- [x] A group with a failed session and a pending question renders per the documented precedence,
      not by accident — needs-input wins (tested); rationale recorded above and in the source
      comment.
- [x] The count pill's colour is unchanged in every case — `.workspaceCount` CSS untouched.
- [x] No raw px/hex — no new CSS was added by this task; the pulse modifier's CSS (task-002) and
      existing header CSS are both token-based already.

## Follow-ups / TODO(verify)

- Manual visual sign-off (`#ui select` in a session, collapse its group, observe the dot; expand,
  confirm it clears; answer with the group collapsed, confirm the dot clears) deferred to task-009's
  consolidated matrix.
- Task-004's tab dot should reuse `StatusDot`'s new `"aria-label"` prop the same way, for the same
  § 08 "never colour alone" rule.
