# Task 001 — Shared `openNewChat` helper alongside `openNewTerminal`

- **Sprint:** sprint-038-tab-strip-new-tab-menu
- **Status:** done
- **Estimated size:** S
- **Depends on:** none

## Goal
Extract the duplicated "create a session, then open its chat tab" sequence into one shared
`openNewChat(workspaceCwd)` helper in `tab-store.ts`, mirroring the existing `openNewTerminal`
helper, so every caller (including the new "+" button in task-002) mints identical tab ids/labels.

## Scope references
- `packages/web-client/src/stores/tab-store.ts` (`openNewTerminal`, `tabIds`, doc comment already
  anticipating "the TabStrip's '+' button")
- `packages/web-client/src/stores/session-store.ts` (`createSession`)
- `packages/web-client/src/features/sessions/SessionList.tsx` (`handleNewSession`, lines ~35-46)
- `packages/web-client/src/features/sessions/open-workspace.ts` (`openWorkspace`, create-new branch)
- `packages/web-client/src/hooks/use-session-restore.ts` (bootstrap "no sessions" branch, ~lines 97-108)

## What to build
- In `tab-store.ts`, add:
  ```ts
  export function openNewChat(workspaceCwd: string): void
  ```
  Behaviorally: calls `useSessionStore.getState().createSession(workspaceCwd)`, then
  `useTabStore.getState().open({ id: tabIds.chat(id), kind: "chat", label: "New chat",
  closable: true, data: { sessionId: id }, workspaceCwd })` — exactly the shape already inlined in
  `SessionList.tsx#handleNewSession`. `tab-store.ts` importing `session-store.ts` is safe: confirmed
  no reverse import exists (`session-store.ts` has zero references to `tab-store`).
- Update `SessionList.tsx#handleNewSession` to call `openNewChat(targetCwd)` instead of inlining
  `createSession` + `openTab`. Keep its own `normalizeCwd(targetWorkspaceCwd || "~", homeDir)` step
  before calling the helper — normalization stays the caller's job, the helper takes an
  already-normalized cwd (same contract as `openNewTerminal`).
- Update `open-workspace.ts#openWorkspace`: keep the "reuse existing session" branch as-is; replace
  only the `createSession(cwd)` + manual `open({...})` pair in the "no existing session" path with
  `openNewChat(cwd)` — but note `openWorkspace` also calls `activate(sessionId)` on the session
  store immediately after, which `openNewChat` does not do, so keep that line separate after the
  helper call (or confirm `createSession`/`open` already imply activation — check `session-store.ts`
  before assuming).
- Update `use-session-restore.ts`'s "no restored sessions" branch to call
  `openNewChat(targetCwd)` in place of its inlined `createSession` + `tabStore.open(...)`.
- Run `lsp references` on `createSession` and on the inlined `open({ kind: "chat", ... })` shape
  before editing to confirm these three are the only callsites (per current grep results).

## Out of scope
- The TabStrip "+" button UI itself (task-002).
- Any change to `openNewTerminal`'s existing behavior/signature.

## Acceptance criteria
- [ ] `openNewChat(workspaceCwd)` exists in `tab-store.ts`, exported next to `openNewTerminal`.
- [ ] `SessionList.tsx`, `open-workspace.ts`, and `use-session-restore.ts` all call the shared
      helper instead of inlining `createSession` + `open(...)`; no behavior change (same tab id,
      label `"New chat"`, `closable: true`, same `workspaceCwd`).
- [ ] `open-workspace.ts` still calls `activate(sessionId)` for the newly created session if that
      was not already implied by `createSession`/`openNewChat`.
- [ ] `npm run typecheck -w @av-pi-studio/web-client` passes.

## Test / verification plan
- Build: `npm run typecheck -w @av-pi-studio/web-client` succeeds.
- Tests: run existing `packages/web-client/src/stores/*.test.ts` (if any cover
  session/tab creation) via `npx vitest run packages/web-client/src/stores`; all pass, no changes
  needed unless a test asserted the old inline shape.
- Manual check: `npm run dev -w @av-pi-studio/web-client` against a running daemon
  (`npm run dev:daemon`); click the sidebar's per-workspace "New conversation" hover button —
  behavior is unchanged (new "New chat" tab + session appears). Reload the app with zero sessions
  to exercise the `use-session-restore.ts` path.

## Notes
- This is a pure refactor with zero new user-visible behavior — the payoff is task-002 having one
  correct helper to call instead of a fourth copy-paste.
