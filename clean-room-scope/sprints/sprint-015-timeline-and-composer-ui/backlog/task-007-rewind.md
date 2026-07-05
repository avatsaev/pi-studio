# Task 007 — Rewind (conversation & file time-travel)

- **Sprint:** sprint-015-timeline-and-composer-ui
- **Status:** backlog
- **Estimated size:** M
- **Depends on:** task-002 (message rows); task-006 (composer, for the restore-text behavior)

## Goal
Implement rewind end-to-end: the small additive protocol/daemon amendment it requires (a new RPC +
capability flags — this feature does not exist in any prior sprint 001–011), and the client UI (a
per-message rewind menu, post-rewind resync, and composer text restore).

> This is the one task in the UI sprints that also touches `packages/protocol` and
> `packages/server`. Coordinate with whoever owns those packages; the protocol/server pieces are
> small and additive (no existing schema is changed, only extended).

## Scope references
- `clean-room-scope/features/rewind.md` (all sections — the full contract)
- `clean-room-scope/features/agent-providers.md` § Capability flags (extend, don't replace)
- `clean-room-scope/features/timeline-rendering.md` § Row treatments (user message actions row)
- `clean-room-scope/architecture/websocket-protocol.md` § RPC naming (dotted convention)

## What to build
- **Protocol (additive):** extend `AgentCapabilityFlags` with `supportsRewindConversation?`,
  `supportsRewindFiles?`, `supportsRewindBoth?` (all optional booleans — old clients/daemons ignore
  unknown fields per the append-only rule). Add `agent.rewind.request` / `agent.rewind.response`
  session messages per the shape in `rewind.md`.
- **Daemon:** implement `mode: "conversation"` (truncate the agent's persisted timeline back to before
  `messageId`) and `mode: "files"` (revert workspace file changes since a checkpoint at/near `messageId`
  — for a worktree-backed workspace, a git-based revert is the reference mechanism; TODO(verify) exact
  checkpoint strategy for non-git workspaces) and `mode: "both"`. Report the new capability flags from
  providers that support them (mock provider: support all three for testability; real provider(s):
  gate on actual support).
- **Client:** the rewind menu component (hover-revealed on web, always visible native/compact) on each
  user message, built from the agent's capability flags (empty → render nothing); the rewind mutation
  (calls `agent.rewind.request`, single in-flight guard, toast on error); post-success resync (clear
  optimistic messages, re-fetch the timeline tail from the last cursor for conversation/both); composer
  text restore (only when the composer is empty) for conversation/both.

## Out of scope
- Any other new daemon RPCs. Timeline reducer/dedup logic itself (task-001) — this task only triggers a
  resync through the existing reducer.

## Acceptance criteria
- [ ] A user message's rewind menu lists exactly the modes the agent's capability flags advertise, and
      renders nothing when none are supported.
- [ ] `agent.rewind.request` with `mode:"conversation"` truncates the daemon's persisted timeline and the
      client resyncs without duplicate/stale rows.
- [ ] `mode:"files"` reverts workspace file changes without touching conversation history.
- [ ] The composer is only auto-filled with the rewound text when it was empty beforehand.
- [ ] A failed rewind toasts the error and leaves the menu usable for retry.
- [ ] Old capability-flag consumers (that don't know about the three new flags) are unaffected
      (append-only extension).

## Test / verification plan
- Tests: `npx vitest run` for capability-gated menu construction, the rewind mutation's success/error/
  in-flight-guard paths, composer-restore-when-empty logic, and (server-side) timeline truncation +
  file-revert unit tests against the mock provider.
- Manual: rewind a mock-provider agent in each of the three modes and confirm the timeline/composer/
  filesystem behave as specced.

## Notes
- This is new scope discovered against the live Paseo reference during a later audit pass (see
  `clean-room-scope/features/rewind.md` § Status note); it postdates sprints 002/006 and is added here
  as a self-contained additive task rather than reopening those completed sprints.
