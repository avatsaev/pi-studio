# Task 002 — TabStrip "+" button with New chat / New terminal menu

- **Sprint:** sprint-038-tab-strip-new-tab-menu
- **Status:** done
- **Estimated size:** S
- **Depends on:** task-001

## Goal
Add a `+` control at the trailing end of `TabStrip.tsx` that opens a two-item dropdown
("New chat" / "New terminal"), both scoped to the currently visible workspace, closing GitHub
issue #8.

## Scope references
- `packages/web-client/src/features/workspace/TabStrip.tsx` (full component — `TabItem`, `TabStrip`,
  `DndContext`/`SortableContext` structure)
- `packages/web-client/src/features/workspace/TabStrip.module.css` (`.strip`, `.tab`, `.close`
  token usage for style parity)
- `packages/web-client/src/stores/tab-store.ts` (`openNewTerminal`, `openNewChat` from task-001,
  `activeWorkspaceCwd`)
- `packages/web-client/src/features/sessions/SessionContextMenu.tsx` +
  `SessionContextMenu.module.css` (established Radix `DropdownMenu` pattern: `.content`, `.item`,
  `.sep` — reuse this shape, not a new one)
- `packages/web-client/src/hooks/use-shortcuts.ts` (existing `Ctrl/Cmd+T` → `openNewTerminal`
  fallback-to-`"~"` convention to mirror for the null-workspace case)

## What to build
- New sub-component in `TabStrip.tsx` (or a colocated `NewTabMenu.tsx` if it grows past ~40 lines):
  a Radix `DropdownMenu.Root` whose trigger is a small icon-only button (`Plus` from
  `lucide-react`, matching the `.close`/`.icon` sizing already in the file) rendered **after** the
  mapped `TabItem`s but **outside** `SortableContext` (must not be draggable or affect
  `reorder`/`closestCenter` collision detection).
  - Menu items: "New chat" → `openNewChat(cwd)`; "New terminal" → `openNewTerminal(cwd)`, where
    `cwd = activeWorkspaceCwd ?? "~"`.
  - Trigger is `disabled` when `activeWorkspaceCwd` is `null` (transient pre-connection/no-workspace
    state — do not create an orphan tab against a bogus cwd).
- Add trigger + menu styles to `TabStrip.module.css`: a `.newTab` button (same muted → hover
  foreground token pattern as `.close`), sized/aligned to sit inline with `.strip`'s flex row. Reuse
  or mirror `SessionContextMenu.module.css`'s `.content`/`.item`/`.sep` class shapes for the
  dropdown content (same `--pi-*` tokens, `sideOffset`, `align="start"`) — do not invent a third
  visual style for dropdown menus in this codebase.

## Out of scope
- No new keyboard shortcut for "new chat" — only the button. `Ctrl/Cmd+T` for terminal is untouched.
- No server/protocol changes.

## Acceptance criteria
- [ ] A `+` control is visible at the end of the tab strip for every workspace.
- [ ] Clicking it opens a menu with exactly "New chat" and "New terminal".
- [ ] "New terminal" opens a new terminal tab in the active workspace (same result as `Ctrl/Cmd+T`).
- [ ] "New chat" creates a new session + chat tab in the active workspace (same result as the
      sidebar's "New conversation" hover button).
- [ ] The `+` control is not part of the sortable tab list — dragging tabs around it still reorders
      correctly and dropping on/near it does not error or reorder it.
- [ ] The trigger is disabled (not clickable) when no workspace is active.
- [ ] `npm run typecheck -w @av-pi-studio/web-client` passes.

## Test / verification plan
- Build: `npm run typecheck -w @av-pi-studio/web-client` succeeds.
- Manual check: `npm run dev -w @av-pi-studio/web-client` against `npm run dev:daemon`.
  1. Click `+` → "New terminal": a `Terminal N` tab opens with a live shell at the workspace cwd.
  2. Click `+` → "New chat": a "New chat" tab + session appears in the sidebar under the current
     workspace.
  3. Drag-reorder existing tabs — confirm the `+` control stays fixed at the end and reorder still
     works via `reorder()`.
  4. Switch workspaces (if multiple are open) and repeat — confirm both actions land in the newly
     active workspace's cwd, not a stale one.

## Notes
- `openNewTerminal`'s doc comment in `tab-store.ts` already says it's "Shared by the `Ctrl/Cmd+T`
  shortcut … and the TabStrip's '+' button" — this task is what makes that comment true.
