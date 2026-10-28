# Task 003 — `TodoPanel` component, mounted between timeline and composer

- **Sprint:** sprint-080-agent-todos-ui
- **Status:** done
- **Type:** feature
- **Area:** packages/web-client (features/chat/todos, features/chat/ChatPanel)
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** task-001, task-002

## Goal

Every chat pane whose agent has at least one todo shows the panel above its composer, with the
header, rows, grouping, scrolling and accessibility the spec defines.

## Context / why

This is the user-visible half of the feature. All branching is already pure (task-001) and all
state is already in the store (task-002), so this task is markup, CSS and one scroll effect.

## Scope references

- swe/features/agent-todos-ui.md § Behavior (Placement & visibility, Header, Rows, Scale,
  Accessibility), § Error handling & edge cases, § Acceptance U1–U8, U10
- packages/web-client/src/features/chat/ChatPanel.tsx:20-38 (`session.agentId: string | null`;
  insert between `<Timeline>` and `<Composer>`)
- packages/web-client/src/features/sessions/SessionList.module.css:206-210 (chevron-rotate disclosure
  on a plain `<button>`)
- packages/web-client/src/components/primitives/Icon.tsx (token-sized `lucide-react` icons)
- packages/web-client/src/components/primitives/Spinner.module.css:21-24 (reduced-motion guard)
- packages/web-client/src/theme/tokens.ts; tests `theme/font-scale.test.ts:46-58`,
  `theme/token-integrity.test.ts` (only `var(--pi-*)` tokens; no literal font sizes)
- `swe/UI design/redesign 0.1.0/Extension Dialogs Visual Spec.html` (§ 09: only a signature table
  is extractable, so there is no widget block chrome to copy; see Notes)

## What to build

- `features/chat/todos/TodoPanel.tsx` + `TodoPanel.module.css`, props `{agentId: string | null}`.
  - **Rendering conditions:** renders `null` when `agentId` is null (a draft conversation), when
    the snapshot is absent, or when `tasks` is empty. It calls `track(agentId)` in an effect and
    releases on unmount or agentId change, so a draft that binds starts tracking.
  - **Header:** a real `<button aria-expanded aria-controls>` holding the chevron, the label
    `Todos`, `done/total`, and, when collapsed, `collapsedSummary` ellipsized on one line.
    `collapsed` comes from `useTodoPanelCollapsed(agentId)`; toggling calls `setCollapsed`.
  - **Body:** an `<ol>` of `panelRows`, capped at about 40% of the pane height (CSS on the panel
    container relative to `ChatPanel`, not `vh`) with `overflow-y: auto`.
    - Row icon per status: pending is an empty circle, in-progress is a spinner (static under
      reduced motion), completed is a check and the text is dimmed and struck through.
    - Row text is `rowText`; there is a `#id` affordance and a `blockedByLabel`.
    - Expandable rows are buttons that reveal `description` and `owner`. Expanded-row state is
      local component state, deliberately not persisted (spec).
    - The completed group is a button showing `N completed` that expands in place.
  - **Truncation:** when `truncated`, a footer line reads `Showing first 200 tasks` from
    `AGENT_TODOS_MAX_TASKS`.
  - **Plain text only:** React text nodes, never `dangerouslySetInnerHTML` (U8).
  - **In-progress scrolling:** when the in-progress task's id changes, scroll that row into view
    **inside the panel body only**, by setting the body's `scrollTop` and never `scrollIntoView`,
    which would scroll the timeline too.
  - **Region:** `role="region"` with `aria-label="Agent todos"`.
- `ChatPanel.tsx` mounts `<TodoPanel agentId={session.agentId} />` between `Timeline` and
  `Composer`.
- **Strings:** English literals, matching every existing web-client component. The spec's
  "i18next keys under `todos.*`" is wrong for this codebase: web-client has no i18n library,
  locale files or `useTranslation` anywhere. Amend the spec rather than introduce i18n
  infrastructure for one panel.

## Out of scope

- `aria-live` announcements, editing, sub-agent nesting, markdown (spec non-goals)

## Acceptance criteria

- [ ] `npm run build:web-client` and both theme token tests pass
- [ ] Manual check on the dev daemon (`npm run dev:daemon` + web-client dev server), driving
  sprint-079's `#todo` recipes:
  - `plan` shows the panel;
  - `advance` moves the spinner and scrolls only the panel;
  - `done` keeps the panel with every row checked;
  - `many` groups 7 completed tasks and caps the height with a scroll;
  - `blocked` shows `blocked by #n` and an expandable description/owner;
  - `literal` renders literally;
  - `huge` shows the truncation footer;
  - `clear` hides the panel;
  - collapse survives a reload;
  - two panes on the same agent agree;
  - the draft → bound transition shows the panel without a reload.
- [ ] Keyboard: Tab reaches the toggle and expandable rows; Enter/Space toggle them; focus returns
  to the composer normally
- [ ] Screenshots for light and dark themes attached to the summary for the user's visual sign-off

## Test / verification plan

- Build and the token tests
- Browser verification as above, with screenshots

## Notes

- Visual design has no dedicated spec: § 09's only extractable content is the `setWidget` signature
  table. Use the extension-dialog card's surface/border/radius tokens (`AskCard.module.css`) so the
  panel reads as the same family, then get explicit user sign-off on the screenshots. A rejection
  becomes a follow-up within this sprint, not a new spec.
