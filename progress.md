# Progress — Workspace UI scouting

Status: COMPLETE

Task: Clean-room behavioral findings on the Paseo Expo app workspace screen, panes, and tabs.

Output written to: /tmp/paseo-ui-scope/02-workspace-ui.md

## What was explored
- screens/workspace/* (workspace-screen, pane-content, pane-state, route-state, tab-model,
  tab-menu, tab-presentation, desktop-tabs-row, use-workspace-tab-layout, use-mounted-tab-set,
  bulk-close, scripts-button, open-in-editor-button, header-source, empty-draft-seed,
  draft-agent-config, draft-pane-focus, use-workspace-tab-rename, tab-layout)
- workspace/* (workspace-archive, focus), workspace-tabs/* (identity, agent-visibility)
- panels/* (panel-registry, register-panels, pane-context, agent/draft/terminal/browser/file/setup panels)
- stores/workspace-layout-store.ts, stores/workspace-layout-actions.ts, stores/workspace-tabs-store/*
- components/split-container.tsx, constants/layout.ts

## Document covers
- workspace screen layout (header / tab strip / pane content / composer / explorer)
- tab model (kinds, deterministic ids, panel registry, open/close/rename/reorder, reconcile,
  per-client layout vs global archive, mounted-tab LRU keepalive)
- pane/split model (SplitPane/SplitGroup tree, web-only DnD splits via dnd-kit, focus + restoration)
- secondary header, scripts button, open-in-editor, bulk close, empty-draft seeding, route gating
- desktop vs compact vs web-only feature matrix
- start-here list + TODO(verify) open questions

All sections cite exact file paths. A handful of TODO(verify) flags remain (noted in doc §14).

## Timeline / agent-stream rendering scout (done)
Wrote clean-room findings to /tmp/paseo-ui-scope/03-timeline-rendering.md.
Covered: StreamItem row-kind catalog (user/assistant/thought/tool_call/todo/activity_log/compaction),
ToolCall/ExpandableBadge lifecycle states + shimmer/error, per-tool presentation (icon + displayName/summary),
tool-call detail bodies (shell/edit-diff/read/write/search/fetch/sub_agent/plain_text/unknown),
permission/plan/question cards, attachments/images, file-link chips, DiffViewer colors,
turn grouping + turn footers + turn-time, autoscroll bottom-anchor state machine + web partial virtualization,
markdown feature support, and @getpaseo/highlight syntax-token wiring.
Key entry: packages/app/src/agent-stream/view.tsx (renderStreamItemContent switch).
