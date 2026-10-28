# Feature (UI) — Agent Todos panel above the composer

> **Status: shipped** in `sprint-080-agent-todos-ui` (relay transport and a manual two-agent check not run).

> Part of: [../MAIN-SCOPE.md](../MAIN-SCOPE.md)
> Dependencies: [agent-todos.md](agent-todos.md) (wire + SDK: `AgentTodosSnapshot`,
> `listAgentTodos`, `onAgentTodosUpdate`, `hasAgentTodosCapability`), [composer-ui.md](composer-ui.md)
> (composer regions), [workspace-split-panes.md](workspace-split-panes.md) (per-pane chat panels,
> per-workspace persistence), [ui-components.md](ui-components.md), [localization.md](localization.md),
> [../architecture/design-system.md](../architecture/design-system.md)
> Source brief: [../grills/todo-extension-ui.md](../grills/todo-extension-ui.md). `Dnn` cites its
> decisions.

## Purpose

This panel gives the user a glanceable, always-current view of the agent's plan while it works (D2),
matching rpiv-todo's TUI overlay, which Pi places `aboveEditor`. The panel is read-only (D4). It sits
directly **above the composer** in each chat pane (D3) and shows only when the pane's agent has at
least one non-deleted todo (D5).

## Public contract (component + store)

| Unit | Contract |
|------|----------|
| `features/chat/todos/agent-todos-store.ts` | A zustand store wrapping the SDK reducer: `snapshotFor(agentId)`, hydrated by `listAgentTodos` on mount, on reconnect, and when a pane binds a new agent; fed by `onAgentTodosUpdate`. It is a no-op when `!hasAgentTodosCapability()` |
| `TodoPanel` (`features/chat/todos/TodoPanel.tsx`) | Props `{agentId}`. Rendered by `ChatPanel` between the timeline and the `Composer`, once per chat pane (D11) |
| Collapse state | `collapsed: boolean` per conversation (agentId), persisted per workspace alongside the existing layout/tab state (survives reload). Default: `false` (expanded) (D8) |
| Pure helpers | `todo-panel-model.ts`: `visibleTasks`, `counts {done, total}`, `inProgress` (first `in_progress` by id), `groupCompleted(tasks, threshold=5)`, all unit-tested |

## Behavior

### Visibility (D5, D18)
```
show panel iff capability && snapshot(agentId).tasks.length > 0
```
- The panel appears automatically on the first todo push. It disappears when the list empties or is
  cleared, or after archive/delete (the daemon sends an empty snapshot). It stays visible when every
  task is completed (D10).
- It never changes the pane or tab layout, and it never steals focus.

### Header (always visible)
- Label `Todos`, a `done/total` count, and a chevron toggle. When collapsed, the header also shows the
  **in-progress task's `activeForm`** (falling back to its subject), ellipsized to one line (D8).
- The toggle is a real `<button>` with `aria-expanded`, and `aria-controls` pointing at the list. The
  panel is a labelled region (`role="region"`, `aria-label="Agent todos"`). There is no `aria-live`
  per update (D19, deferred).
- When `truncated`, the header shows a muted "showing first 200" hint.

### Rows (D9)
| Status | Icon | Text |
|--------|------|------|
| `pending` | empty circle | subject |
| `in_progress` | spinner/half circle (respects `prefers-reduced-motion`) | `activeForm` if present, else subject; emphasized |
| `completed` | check | subject, dimmed and struck through |

- `blockedBy` non-empty and status ≠ completed: shows a muted `blocked by #a, #b` suffix. A missing
  id still shows as `#n`.
- Each row's subject is one line with an ellipsis; the full text goes in `title`. Clicking or pressing
  Enter on a row **expands it inline** to show `description` (pre-wrap) and `owner`, when present.
  Rows with neither are not expandable.
- Rows are ordered by id and keyed by `(id, index)` (duplicate ids are tolerated).
- **Plain text only (D17):** no markdown, no link detection, no HTML. Text is rendered as React text
  nodes.

### Scale (D10)
- The panel body has a max height of about 40% of the chat pane's height and scrolls internally. The
  composer and timeline never get pushed off screen.
- When more than 5 tasks are completed, they collapse into a `N completed` disclosure row, placed at
  their first position. The disclosure's expanded state is local and not persisted.
- Opening the panel, or a new push arriving, scrolls the in-progress row into view inside the panel
  body only (never the page).

### Multi-pane, sub-agents, reconnect
- Each chat pane shows its own agent's panel. Two panes on the same agent show the same list, but
  each keeps its own expanded-row state while sharing the per-conversation collapse state.
  Sub-agent lists show only in the sub-agent's own chat (D11).
- On reconnect, the store resets seq tracking and refetches each bound agent with `list`. If a list
  request fails, the store keeps whatever snapshot it has and shows nothing new.

### Theming / i18n
- Uses design-system tokens only, so it works in both light and dark themes. Strings are English
  literals: web-client has no i18n library, so no `todos.*` keys exist (amended at sprint-080).

## Error handling & edge cases

| Condition | Expected behavior |
|-----------|-------------------|
| Old daemon (no `agentTodos`) | No panel, no requests, no errors |
| `list` rejects or times out | Panel absent until the next push; no toast |
| Draft (unmaterialized) chat | No `agentId`, so no panel |
| Agent with only `deleted` tasks | Daemon sends empty `tasks`, so no panel |
| Very long subject or description | Subject ellipsized; description wraps inside the scroll body |
| Markdown/HTML in task text | Rendered literally |
| Stale push (`seq ≤ last`) | Dropped by the reducer |
| Panel collapsed while new tasks arrive | Stays collapsed; header count and activeForm update |
| Extension UI dialog cards and the turn progress bar | The panel sits above the composer and below the timeline; dialog cards remain in the transcript (s068) and are unaffected |

## Dependencies on other specs
- [agent-todos.md](agent-todos.md): all data.
- [composer-ui.md](composer-ui.md) / `ChatPanel`: insertion point between the timeline and the
  composer.
- [workspace-split-panes.md](workspace-split-panes.md): per-workspace persisted UI state for
  `collapsed`.

## Acceptance criteria
- [x] **U1** Given an agent's first todo push, then the pane shows the panel above the composer,
  expanded, with the correct `done/total`, without changing focus or layout.
- [x] **U2** Given an `in_progress` task, then its row shows `activeForm`, and when collapsed the
  header shows it on one line.
- [x] **U3** Given a collapse toggle and then a browser reload, then the panel is restored collapsed
  for that conversation only.
- [x] **U4** Given more than 5 completed tasks, then they are grouped in an `N completed` row; a long
  list scrolls within about 40% of pane height.
- [x] **U5** Given `blockedBy:[2]`, then a `blocked by #2` hint shows; given a description, then the
  row expands to show it.
- [x] **U6** Given task text `**x** <b>y</b> [l](http://e)`, then it renders literally.
- [ ] **U7** *(per-agent keying is store-tested; a manual two-agent check was not run)* Given two panes on two agents, then each shows only its own list.
- [x] **U8** Given an emptied list, or an archived agent, then the panel disappears.
- [x] **U9** Given an old daemon, then no panel and no console errors.
- [x] **U10** Keyboard: the toggle and expandable rows are reachable by Tab and operable with
  Enter/Space; `aria-expanded` reflects state.
- [ ] **U11** *(dev daemon + real Pi 1.4.0/rpiv-todo 2.15.0 verified in Chromium; relay transport NOT run)* Live-verified in a browser against the dev daemon (mock scripted todos) and against a
  real Pi with `rpiv-todo`, including over the relay transport.

## TODO(verify)
- [x] Persistence slot for `collapsed`: **resolved (sprint-080)** — a sibling localStorage record
  `pi-studio-agent-todos-ui` keyed by `agentId`, not the pane layout (which is keyed by tab identity).
- [x] Visual sign-off — **given by the user on the live dev daemon ("looks cool")**. There is no visual spec for this panel (the § 09 widget block in
  `Extension Dialogs Visual Spec.html` is generic, opaque lines). Reuse its block chrome where it
  fits. Owner: engineer (user) sign-off on the UI task.
