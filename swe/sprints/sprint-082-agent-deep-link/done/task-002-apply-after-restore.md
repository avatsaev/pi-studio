# Task 002 — Apply the deep link after session restore, and on `hashchange`

- **Sprint:** sprint-082-agent-deep-link
- **Status:** done
- **Type:** feature
- **Area:** packages/web-client (hooks, app.tsx)
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** task-001

## Goal

Once the connection is open and the initial restore has hydrated the agent list, the target agent
is selected exactly as a sidebar click selects it. Otherwise the user gets one "not found" toast.
Either way the `agent` key leaves the address bar.

## Context / why

`useSessionRestore` runs once per connection (`restoredRef`). `runSessionRestore` always reaches
its `finally`, where it calls `markHydrationSource("sessions")`. Applying after that settle lets
the explicit link override restore's default focus instead of racing it. A sidebar click is
`activate(id)` + `setCwd(cwd)` + `openChatTab(session, homeDir)` (`SessionList.tsx:48-51`).

## Scope references

- swe/features/web-ui-agent-deep-link.md § Behavior contract 1–4, § Behavior & algorithms
  (`tryApply`, Timing), § Error handling & edge cases
- packages/web-client/src/app.tsx (`Boot`: `useConnectionBoot`, then `useSessionRestore`)
- packages/web-client/src/hooks/use-session-restore.ts:86-135 (`restoredRef`, `runSessionRestore`
  `finally`)
- packages/web-client/src/features/sessions/SessionList.tsx:40-51, `open-chat-tab.ts`
- packages/web-client/src/stores/session-store.ts (`findByAgentId`, `activate`), `tab-store.ts`
  (`open` reuses `tabIds.chat(session.id)`), `layout-store.ts` (pending-claim restore guard),
  `toast-store.ts` (`show`)
- packages/web-client/src/hooks/use-home-dir.ts (home dir for `openChatTab`)

## What to build

- `applyAgentDeepLink(deps)` in `lib/agent-deep-link.ts` (or a sibling module), with its effects
  injected so Node tests can drive it:
  - consume the pending id;
  - known agent: `activate`, `setCwd`, `openChatTab`;
  - unknown: `toast.show("Agent not found: <id>", warning)`;
  - then `history.replaceState(null, "", stripAgentParam(location.href))`.
- `deep-link-store` gains a `restored: boolean` flag. `useSessionRestore` calls apply after
  `runSessionRestore` settles and sets `restored = true`. It is reset when a new connection starts,
  without re-applying a consumed target. Restore's own algorithm does not change.
- `hooks/use-agent-deep-link-boot.ts`, mounted in `Boot` after `useConnectionBoot` and before
  `useSessionRestore`:
  - on mount, parse `location.hash` and store any id;
  - on `hashchange`, store the id, and apply at once if the connection is open and `restored` is
    true;
  - remove the listener on unmount.
- English literal string. The web client has no i18n (see sprint-080's refinement); this answers
  spec TODO #3.

## Out of scope

- Auto-connecting from a bare link (rejected by the spec).
- A distinct "archived" message (spec TODO #4: an archived agent is indistinguishable at apply
  time; same toast).

## Acceptance criteria

- [ ] Apply with a hydrated session for `abc` activates it, sets its cwd, opens or activates its
  chat tab, shows no toast, and removes `agent` from the URL.
- [ ] Apply with `nope` shows exactly one toast `Agent not found: nope` and changes neither the
  active session nor the tabs. The URL loses `agent`.
- [ ] Applying when the chat tab is already open opens no duplicate tab (same tab id).
- [ ] A consumed target is never re-applied. Across a simulated reconnect (open → connecting →
  open), restore does not re-run and nothing is applied again. A target still pending (never
  connected) stays pending.
- [ ] Layout-restore test (spec TODO #2): a pane claim restored for a different session does not
  replace the deep-link tab as the focused pane's active tab after apply.
- [ ] `useConnectionBoot` behaviour is unchanged: `#offer=…&agent=…` still connects at once, and a
  bare `#agent=…` opens no connection.

## Test / verification plan

- Extend `packages/web-client/src/hooks/use-session-restore.test.ts` (or a new
  `agent-deep-link-apply.test.ts`) driving the stores directly, as the existing restore tests do.
- `npx vitest run packages/web-client/src/hooks packages/web-client/src/lib`
- `npm run build:web-client`; `npx oxfmt <changed files>`; `npm run lint`

## Notes

- `replaceState` does not fire `hashchange`, so cleanup cannot loop.
- An agent created after restore is not found (one-shot apply). This is intended by the spec.
