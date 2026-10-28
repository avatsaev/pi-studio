# Task 001 — Summary
- **Status:** done (2026-10-28)
Built `features/chat/todos/todo-panel-model.ts` (counts, inProgress, rowText, collapsedSummary, blockedByLabel, isExpandable, panelRows with a 5-task group threshold, visibleTasks) and `todo-collapse-codec.ts` (key `pi-studio-agent-todos-ui`, `{version:1, collapsed}` capped at 500, oldest evicted, corrupt input → empty set), with 11 Node tests. `npx vitest run packages/web-client/src/features/chat/todos` → 11 passed; oxlint/oxfmt clean.
All acceptance criteria met (no in-progress, duplicate ids, 5 vs 6 completed, dangling blockedBy, completed never blocked; codec round trip/corrupt/eviction).
