# Task 006 — Restore every claimed chat tab, keyed on a stable agent identity

- **Sprint:** sprint-049-workspace-split-panes-ui
- **Status:** in_progress
- **Type:** bugfix
- **Area:** web-client / hooks
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-001

## Goal
A reload restores the chat tabs the persisted layout asks for — all of them, in their panes — not
just the single most-recent conversation.

## Context / why
Added during sprint-049 implementation: sprint-048 built the claim machinery, but two defects in the
surrounding client make a chat pane impossible to restore, so § Acceptance Criteria (Restore) and
task-007 step 7 cannot pass as-is.

1. **Chat identity is not stable across a reload.** `tabIdentity` returns
   `agent:${sessionId}`, but a session created in this browser gets `s-<seq>`
   (`session-store.ts#newSessionId`) while the same conversation comes back from the daemon as
   `s-<agentId.slice(0,12)>` (`use-session-restore.ts:148`). The identity a chat writes is therefore
   never the identity it presents on the next load. The **agent id** is the stable, daemon-side
   name and the only correct key; a draft with no bound `agentId` has nothing to restore against and
   must return `null` (the identity-less contract already handles that).
2. **Only one chat tab is ever reopened.** `restoreAgents` hydrates every agent into `session-store`
   but opens a tab for `order[0]` alone (`use-session-restore.ts:161–182`) — a deliberate
   single-tab default from before panes existed. A layout claiming three chat panes gets one tab,
   and the other two panes are pruned at the settle point.

## Scope references
- `clean-room-scope/features/workspace-split-panes.md` § Restoring a persisted layout, § Tab identity
- Modify: `packages/web-client/src/stores/tab-store.ts` — `tabIdentity`'s `chat` branch
- Modify: `packages/web-client/src/hooks/use-session-restore.ts` — `restoreAgents` tab opening
- Modify: `packages/web-client/src/lib/pane-layout-persistence.test.ts` (identity cases)
- Modify/create tests: `packages/web-client/src/hooks/restore-hydration.test.ts` (restore-claimed
  coverage) or a sibling test file

## What to build
- **Identity**: `tabIdentity` for a `chat` tab resolves the session's `agentId` from `session-store`
  and returns `agent:<agentId>`, or `null` when unbound. Unbound is the eager-materialization
  window only (`materialize.ts` binds within one RPC of the tab appearing), so the practical loss is
  a tab reloaded in the first instant of its life.
- **Restore**: after hydrating, `restoreAgents` opens a chat tab for **every** hydrated session whose
  identity appears in the active workspace layouts' pending claims (read
  `useLayoutStore.getState().layouts[cwd].pendingPlacement`), plus the existing `order[0]` default
  when nothing is claimed. Preserve today's behaviour exactly when the record is empty (fresh
  install, corrupt storage, `version` bump): one tab, the most recent conversation.
- Claimed opens must not fight the persisted focus: they route through `tab-store.open` →
  `claimPaneFor`, which already declines to move focus for a claim-driven arrival (sprint-048).
- Sidebar/`session-store.activate` and `ui-store.setCwd` keep pointing at `order[0]` as today —
  restoring extra tabs must not change which conversation the sidebar highlights.

## Out of scope
- Restoring file/diff/molecule tabs (their identity is a path; reopening them on load is a separate
  product decision, not part of this feature).
- Any change to the settle point or claim consumption (sprint-048, unchanged and relied upon).

## Acceptance criteria
- [ ] `tabIdentity` of a chat tab whose session has `agentId: "a-1"` is `agent:a-1`, independent of
      the local session id; an unbound draft's identity is `null`.
- [ ] A record written before a reload and reloaded after one yields matching identities for the same
      conversation (assert with a hydrated session id different from the pre-reload id).
- [ ] With a layout claiming two chat panes and two agents on the daemon, restore opens both chat
      tabs and both land in their claimed panes; neither pane is pruned at the settle point.
- [ ] With no persisted record, restore opens exactly one chat tab (today's behaviour, unchanged).
- [ ] A claimed chat whose agent no longer exists on the daemon leaves its pane pruned at settle
      (no phantom tab, no error).
- [ ] `session-store.activeSessionId` and `ui-store.cwd` after restore are the same as before this
      change (most-recent conversation), regardless of how many tabs were reopened.

## Test / verification plan
- Tests: extend `pane-layout-persistence.test.ts` for the identity change and
  `restore-hydration.test.ts` (or a sibling) for multi-tab claimed restore, driving
  `runSessionRestore` against a stubbed client as the existing tests do. Run
  `npx vitest run packages/web-client/src/hooks/ packages/web-client/src/lib/`.
- Build: `npm run build:web-client` succeeds.
- Typecheck: `npm run typecheck` succeeds.
- Manual: covered by task-007 step 7 (reload with a two-chat split).

## Notes
- This changes the persisted identity scheme's *values* but not its shape, and the record is
  client-local and disposable: an existing `pi-studio-pane-layout` written with `agent:s-3` keys
  simply fails to match and its chat panes prune at settle — exactly the graceful-degradation path
  the spec already requires. No version bump needed.
