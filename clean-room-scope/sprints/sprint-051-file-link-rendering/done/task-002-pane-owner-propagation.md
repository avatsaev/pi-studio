# Task 002 — Owning-pane id + workspace cwd propagation through the panel/timeline render tree

- **Sprint:** sprint-051-file-link-rendering
- **Status:** done
- **Estimated size:** M
- **Depends on:** none

## Goal
Fix the pre-existing defect that no component between the pane host and a markdown node-override
carries a pane id, by threading `owningPaneId` from `TabPanelHost` down through `ChatPanel` →
`Timeline` → `AssistantRow`/`ReasoningRow` → `Markdown` — and thread the owning tab's
`workspaceCwd` down the same chain, since the spec's amended click contract needs both (the
dispatch's workspace argument is the owning chat tab's workspace cwd, never the `assetBase || "~"`
approximation). task-003 wires the actual click behavior on top of this.

## Background / why
`TabPanelHost.tsx:164` already computes `const pane = layout?.placement[tab.id]` — used today only
by the `onPointerDown` focus handler two lines below — but the panel render call right after it,
`<Panel tab={tab} />` (`TabPanelHost.tsx:179`), never receives it. Every open-file-style dispatch
downstream (`InlineImage.tsx`'s click handler today; this feature's link click after task-003)
therefore has no owning-pane id and falls back to whichever pane happens to be globally focused —
wrong whenever the user last interacted with a different pane before clicking something in this
one. `file-link-rendering.md` § Pane-owner propagation is the exact chain to implement:
```
panel host, for each open tab:
    pane = the tab's owning pane, from the already-computed tab->pane placement
    render the tab's panel component with (tab, owningPaneId = pane)
chat panel:      render its timeline with (session, owningPaneId)
timeline:        render each row with (row, assetBase, owningPaneId)
assistant / reasoning row: render its markdown with (text, assetBase, owningPaneId)
```
A tab not yet placed in any pane (`pane === undefined`) passes `owningPaneId = null`; the
pre-existing "no target given" fallback (globally focused pane) covers that transient case without
throwing or blocking.

The workspace-cwd half needs no new host-level prop: `ChatPanel` already receives the `tab`, and
`tab.workspaceCwd` is the value the spec requires — it only needs threading from `ChatPanel`
downward alongside `owningPaneId`.

## Scope references
- `clean-room-scope/features/file-link-rendering.md` § Click-to-open pane targeting (including the
  "owning chat tab's workspace cwd" implementation note), § Pane-owner propagation
- `packages/web-client/src/features/workspace/TabPanelHost.tsx:161-183`
- `packages/web-client/src/features/workspace/panel-registry.ts` (`PanelProps`)
- `packages/web-client/src/features/workspace/pane-layout-view.ts` (the established no-jsdom home
  for `TabPanelHost`'s testable render decisions — see that file's role in `TabPanelHost`'s header)
- `packages/web-client/src/features/chat/ChatPanel.tsx` (`ChatPanelProps`)
- `packages/web-client/src/features/chat/Timeline.tsx:26-53` (`TimelineProps`, `renderRow`)
- `packages/web-client/src/features/chat/rows/AssistantRow.tsx`,
  `packages/web-client/src/features/chat/rows/ReasoningRow.tsx`
- `packages/web-client/src/timeline/markdown.tsx:61-76` (`MarkdownProps`)

## What to build
- `panel-registry.ts`: add `owningPaneId: string | null` to `PanelProps`. (Type-safe for the other
  three panels without touching them — a component requiring fewer props stays assignable to
  `ComponentType<PanelProps>`.)
- `TabPanelHost.tsx`: change `<Panel tab={tab} />` to `<Panel tab={tab} owningPaneId={pane ?? null} />`.
- `ChatPanel.tsx`: accept `owningPaneId` from `PanelProps`; pass
  `<Timeline session={session} owningPaneId={owningPaneId} workspaceCwd={tab.workspaceCwd} />`.
- `Timeline.tsx`: add `owningPaneId: string | null` and `workspaceCwd: string` to `TimelineProps`;
  add both as `renderRow` parameters so `AssistantRow` and `ReasoningRow` receive them.
- `AssistantRow.tsx` / `ReasoningRow.tsx`: add `owningPaneId?: string | null` and
  `workspaceCwd?: string | null` (defaults `null`, matching `AssistantRow`'s existing `assetBase`
  optionality), forward both to `<Markdown … />`.
- `markdown.tsx`: add `owningPaneId?: string | null` and `workspaceCwd?: string | null` to
  `MarkdownProps` (defaults `null`); pass both to the `img` override (`InlineImage`) as props so
  they're available. Do not consume them inside `InlineImage`'s click handler yet — that behavior
  change is task-003's.

## Out of scope
- Consuming `owningPaneId`/`workspaceCwd` in any click handler (task-003).
- The `a` node override itself (task-003).
- `ReasoningRow`'s pre-existing gap where `Markdown` is rendered with no `assetBase` at all — that
  predates this feature and stays untouched; only the two new props are added to that call site.

## Acceptance criteria
- [ ] `TabPanelHost` passes the tab's placement-derived pane id (or `null` when unplaced) as
      `owningPaneId` into every mounted panel.
- [ ] `ChatPanel` → `Timeline` → `AssistantRow`/`ReasoningRow` → `Markdown` each receive
      `owningPaneId` and `workspaceCwd` without re-deriving either from `useLayoutStore`,
      focused-pane state, or the session — the workspace value's single source is
      `tab.workspaceCwd` at `ChatPanel`.
- [ ] Existing chat rendering, tab-click pane focus, and inline-image rendering are behaviorally
      unchanged — this task only widens prop chains with `null`-defaulted additions; no click
      handler reads the new props yet.
- [ ] `npm run build` and `npm run typecheck` pass (the type chain reaching `MarkdownProps` is
      itself the primary check — a dropped link in the chain is a compile error).

## Test / verification plan
- Typecheck is the load-bearing check for this task (see above).
- Unit: the tab→`owningPaneId` mapping belongs in `pane-layout-view.ts` (the file `TabPanelHost`'s
  header designates for its testable render decisions) — add/extend a case there proving a tab with
  a known placement produces its pane id and an unplaced tab produces `null`.
- Run: `npx vitest run packages/web-client/src/features/workspace packages/web-client/src/features/chat`.

## Notes
Keep the diff mechanical — new optional props at each layer, defaulted to `null`. task-003 is where
they start being read by click handlers.
