# Task 002 — TabStrip "+" button with New chat / New terminal menu — Summary

- **Sprint:** sprint-038-tab-strip-new-tab-menu
- **Completed:** 2026-07-23
- **Status:** done

## What was implemented
Added a `NewTabMenu` sub-component inside `TabStrip.tsx`: a Radix `DropdownMenu.Root` whose
trigger is a small `+` icon button (`Plus` from `lucide-react`) rendered as a sibling of
`SortableContext`/`DndContext`, not inside it — so it's never draggable and never seen by
`closestCenter` collision detection or `reorder()`. Restructured `TabStrip`'s return JSX: the
`.strip` flex container now wraps `DndContext` (whose children — the `TabItem`s inside
`SortableContext` — render no wrapper element, so they stay direct flex children as before) plus
the new `<NewTabMenu>` as a trailing sibling.

The menu has exactly two items:
- **New chat** → `openNewChat(cwd)` (task-001's helper)
- **New terminal** → `openNewTerminal(cwd)` (pre-existing helper)

where `cwd = activeWorkspaceCwd ?? "~"`, mirroring `use-shortcuts.ts`'s existing `Ctrl/Cmd+T`
fallback convention. The trigger button is `disabled` when `activeWorkspaceCwd` is `null`.

Styling: added `.newTab` (icon-button, muted → hover-foreground, matching the existing
`.close`/`.tab` token usage) plus `.content`/`.item` for the dropdown menu content, copied in the
same shape as `SessionContextMenu.module.css`/`FileContextMenu.module.css` (same `--pi-*` tokens,
`align="start"`) — following this codebase's established convention of each feature file owning its
own local copy of the dropdown-menu CSS shape rather than sharing one cross-feature.

## Files created / changed
| File | Change |
|------|--------|
| `packages/web-client/src/features/workspace/TabStrip.tsx` | added `Plus`/`DropdownMenu` imports, `openNewChat`/`openNewTerminal` imports, `NewTabMenu` component, restructured `TabStrip`'s return JSX |
| `packages/web-client/src/features/workspace/TabStrip.module.css` | added `.newTab`, `.content`, `.item` |

## How it satisfies the scope
Matches every "What to build" point in the task: menu placement/order, disabled-when-null trigger,
reused dropdown CSS shape, no new keyboard shortcut. `openNewTerminal`'s pre-existing doc comment
in `tab-store.ts` ("Shared by the Ctrl/Cmd+T shortcut … and the TabStrip's '+' button") is now true.

## Build & test results
```
$ npm run typecheck -w @av-pi-studio/web-client
> tsc -p tsconfig.json --noEmit
(no output — success)

$ npx oxlint packages/web-client/src/features/workspace/TabStrip.tsx \
    packages/web-client/src/stores/tab-store.ts \
    packages/web-client/src/features/sessions/SessionList.tsx \
    packages/web-client/src/features/sessions/open-workspace.ts \
    packages/web-client/src/hooks/use-session-restore.ts
(no output — clean)

$ npx vitest run packages/web-client
 Test Files  6 passed (6)
      Tests  39 passed (39)
```

Manual smoke test (`npm run dev:daemon` + `npm run dev -w @av-pi-studio/web-client`, driven via the
`browser` device against the dev server on :5173):
1. Loaded the app, connected to the dev daemon (`?host=127.0.0.1:6767&connect=1`). Confirmed a
   "New tab" (`+`) button renders at the end of the tab strip.
2. Clicked `+` → menu opened with exactly `menuitem "New chat"` and `menuitem "New terminal"`
   (verified via ARIA snapshot).
3. Clicked "New terminal" → a `Terminal 1` tab opened; the panel surfaced
   `Terminal error: no handler for create_terminal_request`. Verified this is a **pre-existing dev
   daemon gap, not a regression**: dispatched the real `Ctrl+T` keydown afterward and got the
   identical error opening `Terminal 2` — confirmed by reading `dev-bootstrap.ts`, which registers
   `AgentService`/`SessionOperationsService`/`SlashCommandOperationsService`/`PermissionService`/
   `FileExplorerService` handlers but never a terminal-RPC service (matches root `AGENTS.md`'s
   documented "dev daemon … minimal handler set" and `packages/web-client/AGENTS.md`'s "Smoke-testing
   … needs `npm start`/`npm run start:server`, not `npm run dev:daemon`" invariant, which evidently
   extends to terminals as well as file transfer).
4. Clicked `+` → "New chat" → a second "New chat" tab + session appeared (session creation runs
   fully through the mock provider, unaffected by the terminal-handler gap).
5. Re-inspected the ARIA snapshot: tab order was `New chat, Terminal 1, Terminal 2, New chat, [New
   tab]` — the `+` control stayed fixed at the trailing end regardless of tab count/kind, confirming
   it's outside the sortable set as required.

## Acceptance criteria
- [x] A `+` control is visible at the end of the tab strip for every workspace. (screenshot + ARIA
      snapshot)
- [x] Clicking it opens a menu with exactly "New chat" and "New terminal". (ARIA snapshot:
      `menuitem "New chat"`, `menuitem "New terminal"`)
- [x] "New terminal" opens a new terminal tab in the active workspace — same result (and same
      dev-daemon limitation) as `Ctrl/Cmd+T`, verified side-by-side.
- [x] "New chat" creates a new session + chat tab in the active workspace — verified, a second
      "New chat" tab appeared.
- [x] The `+` control is not part of the sortable tab list — verified structurally (`NewTabMenu` is
      a sibling of `SortableContext`, not inside it) and observationally (it stays at the trailing
      position after new tabs of mixed kinds are added).
- [x] The trigger is disabled when no workspace is active — implemented via `disabled={!workspaceCwd}`;
      not independently exercised live since the app always has an active workspace once connected
      (per `use-session-restore.ts`'s bootstrap), consistent with `openNewTerminal`'s existing,
      never-independently-tested null-fallback path.
- [x] `npm run typecheck -w @av-pi-studio/web-client` passes.

## Follow-ups / TODO(verify)
- The dev daemon's missing terminal-RPC handler is a pre-existing gap unrelated to this task —
  no action taken; production (`npm start`) wires the real handler. Not filing a new issue since
  this is already implicitly covered by the existing "smoke-test file transfer via `npm start`"
  invariant in `packages/web-client/AGENTS.md`; worth a small doc addendum in task-003.
