# Task 002 — Owning-pane id + workspace cwd propagation through the panel/timeline render tree — Summary

- **Sprint:** sprint-051-file-link-rendering
- **Completed:** 2026-08-05
- **Status:** done

## What was implemented
Threaded `owningPaneId: string | null` and `workspaceCwd` from `TabPanelHost` down through
`ChatPanel` → `Timeline` → `AssistantRow`/`ReasoningRow` → `Markdown` (and, since `markdown.tsx`'s
`img` override receives the same two props, into `InlineImage`) as purely additive props — no click
handler consumes them yet (that's task-003). `TabPanelHost` derives the owning pane id via a new
pure `resolveOwningPaneId(tabId, layout)` helper in `pane-layout-view.ts` (the file this component's
header already designates as the home for its testable render decisions) instead of computing it
inline, so the mapping itself is unit-tested rather than just exercised implicitly.

Two contract signatures were tightened from an initial pass to match the task's literal, non-optional
signatures at the layers where a real value is always available (`PanelProps.owningPaneId`,
`ChatPanelProps.owningPaneId`, `TimelineProps.owningPaneId`/`workspaceCwd` are all required —
`TabPanelHost` and `ChatPanel` always have a concrete value to pass); `AssistantRow`/`ReasoningRow`/
`MarkdownProps`/`InlineImageProps` stay optional/null-defaulted per the task's explicit note for
those layers.

## Files created / changed
| File | Change |
|------|--------|
| `packages/web-client/src/features/workspace/panel-registry.ts` | `PanelProps` gains `owningPaneId: string \| null` (required) |
| `packages/web-client/src/features/workspace/pane-layout-view.ts` | new exported pure `resolveOwningPaneId(tabId, layout)` |
| `packages/web-client/src/features/workspace/pane-layout-view.test.ts` | new `resolveOwningPaneId` describe block (4 cases) |
| `packages/web-client/src/features/workspace/TabPanelHost.tsx` | `<Panel>` now passes `owningPaneId={resolveOwningPaneId(tab.id, layout)}` |
| `packages/web-client/src/features/chat/ChatPanel.tsx` | `ChatPanelProps` gains required `owningPaneId`; passes it + `tab.workspaceCwd` into `Timeline` |
| `packages/web-client/src/features/chat/Timeline.tsx` | `TimelineProps` gains required `owningPaneId`/`workspaceCwd`; `renderRow` forwards both to `AssistantRow`/`ReasoningRow` |
| `packages/web-client/src/features/chat/rows/AssistantRow.tsx` | optional `owningPaneId`/`workspaceCwd` (default `null`), forwarded to `Markdown` |
| `packages/web-client/src/features/chat/rows/ReasoningRow.tsx` | same, forwarded to `Markdown` |
| `packages/web-client/src/timeline/markdown.tsx` | `MarkdownProps` gains optional `owningPaneId`/`workspaceCwd`, passed to the `img` override (`InlineImage`) |
| `packages/web-client/src/timeline/InlineImage.tsx` | `InlineImageProps` gains optional `owningPaneId`/`workspaceCwd` (not yet consumed — task-003) |

## How it satisfies the scope
Implements `file-link-rendering.md` § Pane-owner propagation's exact chain (panel host → chat panel
→ timeline → row → markdown) and its "owning chat tab's workspace cwd" note — `workspaceCwd`'s single
source is `tab.workspaceCwd` at `ChatPanel`, never re-derived downstream. No click handler reads
either prop yet, matching the task's explicit out-of-scope boundary.

## Build & test results
```
$ npm run typecheck
tsc -b   →   exit 0, no errors
(note: root tsc -b's project references do not include packages/web-client — see build:web-client below)

$ npm run build:web-client
tsc -b (VITE_TARGET=web) && vite build   →   success (caught and required fixing a real
  `Cannot find name 'owningPaneId'` / then a `string | null | undefined not assignable to string | null`
  compile error in ChatPanel.tsx left by the interrupted first pass — see Follow-ups)

$ npx vitest run packages/web-client/src/features/workspace packages/web-client/src/features/chat
Test Files  9 passed (9)
Tests  179 passed (179)   (pane-layout-view.test.ts: 25 tests, up from 22 pre-task)

$ npm run lint
oxlint   →   exit 0 (only pre-existing warnings elsewhere in the repo; two new warnings on
  InlineImage.tsx's still-unused `owningPaneId`/`workspaceCwd` params, expected to clear once
  task-003 consumes them)
```

## Acceptance criteria
- [x] `TabPanelHost` passes the tab's placement-derived pane id (or `null` when unplaced) as
      `owningPaneId` into every mounted panel (verified by `resolveOwningPaneId` unit tests +
      `build:web-client` type-checking the call site).
- [x] `ChatPanel` → `Timeline` → `AssistantRow`/`ReasoningRow` → `Markdown` each receive
      `owningPaneId` and `workspaceCwd` without re-deriving either; workspace's single source is
      `tab.workspaceCwd` at `ChatPanel` (verified by reading the diff chain — no second read-site).
- [x] Existing chat rendering, tab-click pane focus, and inline-image rendering are behaviorally
      unchanged — only additive props, no click handler reads them yet (verified: existing
      workspace/chat test suites pass unchanged in count/behavior beyond the new describe block).
- [x] `npm run build` (via `build:web-client`, the load-bearing gate for this package — see note
      above on root `typecheck`'s project-reference scope) and `npm run typecheck` pass.

## Follow-ups / TODO(verify)
- The first implementation pass (by a subagent) was interrupted before it ran `build:web-client` or
  wrote this summary, and had left `ChatPanel.tsx` referencing an out-of-scope `owningPaneId`
  identifier it never destructured from its own props — a genuine compile error invisible to root
  `npm run typecheck` because web-client isn't in the root project-reference graph. Caught and fixed
  during this completion pass by destructuring `owningPaneId` in `ChatPanel` and tightening
  `ChatPanelProps.owningPaneId` to required to match the now-required `TimelineProps.owningPaneId`.
  Recorded here as a reminder that `build:web-client` (not root `typecheck`) is this package's
  load-bearing compile gate.
- `InlineImage.tsx`'s two new params are intentionally unused until task-003 wires the converged
  click-to-open dispatch.
</content>
