# Task 003 — Host: `launch` (initial connect intent and agent deep link)

- **Sprint:** sprint-093-workbench-host
- **Status:** done
- **Type:** feature
- **Area:** packages/workbench (host, hooks, sessions)
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-001

## Goal
Take the launch parameters and the agent deep link from the host instead of `window.location`.

## Context / why
A browser gets its launch intent from the URL (`?host=&password=&cwd=&connect=1`, `?pair=`, `#offer=`, `#agent=<id>`). A native app gets it from saved profiles, command-line arguments and OS deep links. The workbench must not care which.

## Scope references
- `swe/architecture/workbench-host-adapter.md` § Member contracts (`launch.*`), § Supporting types (`ConnectIntent`)
- `swe/features/web-ui-agent-deep-link.md`
- `packages/workbench/src/hooks/{use-connection.ts,use-agent-deep-link-boot.ts}`
- `packages/workbench/src/features/sessions/apply-agent-deep-link.ts`
- `packages/workbench/src/lib/agent-deep-link.ts`

## What to build
- Add `launch.initialConnect()` and `launch.agentDeepLink.{current, subscribe, consume}` to the host type.
- Browser host: `initialConnect` implements today's URL parsing exactly (a fragment carrying `offer=` or a `pair` parameter always connects; a plain host connects only with `connect=1`); `agentDeepLink.current` parses the fragment, `subscribe` listens to `hashchange`, `consume` strips `agent=` with `history.replaceState`.
- `useConnectionBoot` reads `initialConnect()` once and applies it: pre-fill host, password and working directory, then connect when the intent says so.
- `useAgentDeepLinkBoot` and `applyPendingAgentDeepLink` use the host methods. The rule that the first apply waits for session restore is unchanged.
- Put the decision logic in pure functions so it is testable without a DOM, and test: no intent; pre-fill only; connect; pairing link; a deep link delivered through `subscribe` while connected and restored; `consume` called after apply and after a rejected target.
- Keep `docs/desktop-client-handoff.md` current: update whatever this task makes stale there (status table, workbench and host sections, wire facts, milestones, open questions). Say in the summary what changed in it, or that nothing did.

## Out of scope
- New launch parameters.

## Acceptance criteria
- [ ] No workbench source outside the browser host reads `window.location` or `window.history`.
- [ ] Every URL form that worked before still works in `web-client`.
- [ ] A host whose `initialConnect()` returns `null` shows the connection fields and does not connect.
- [ ] A deep link delivered through `subscribe` opens the agent without a reload.
- [ ] Existing deep-link and connection tests pass.
- [ ] `docs/desktop-client-handoff.md` matches the repository after this task, or the summary states that nothing in it was affected.

## Test / verification plan
- `npx vitest run packages/workbench/src/hooks packages/workbench/src/features/sessions packages/workbench/src/lib`
- Browser check: open `?host=…&connect=1`; open a pairing link; open `#agent=<id>` and change the fragment while the page is open.
