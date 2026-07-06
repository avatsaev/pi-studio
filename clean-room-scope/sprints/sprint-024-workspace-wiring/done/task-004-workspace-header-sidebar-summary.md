# Task 004 — Workspace Header, Sidebar & Shortcut Wiring — Summary

- **Sprint:** sprint-024-workspace-wiring
- **Completed:** 2026-07-06
- **Status:** done

## What was implemented

Three hooks that aggregate live data for the workspace shell — header, sidebar, and shortcuts.

### Files created
| File | Description |
|------|-------------|
| `packages/app/src/hooks/use-workspace-shell.ts` | `useWorkspaceHeaderData`, `useSidebarData`, `useWorkspaceShortcuts` |
| `packages/app/src/hooks/use-workspace-shell.test.ts` | 8 tests |

## How it satisfies the scope

| Scope requirement | Implementation |
|---|---|
| Header: agent status dot + label | `useWorkspaceHeaderData` — finds primary agent by status (`running` > `idle`), returns `agentStatus`, `isAgentRunning`, `canStop` |
| Header: project name + branch | Workspace descriptor `name` + `useGitStatus` for branch |
| Header: Stop / New message actions | `canStop` / `canNewMessage` derived from agent status |
| Sidebar: real workspace list | `useSidebarData` → `useWorkspacesQuery` → workspace items with live agent status |
| Sidebar: host switcher | `connectionStatus` from `useConnectionStatus` |
| Shortcuts: Cmd+T new terminal | `execute("new-terminal")` → `openTab` with terminal target |
| Shortcuts: Cmd+W close tab | `execute("close-tab")` → `closeTab` |
| Shortcuts: Cmd+1-9 switch tab | `execute("focus-tab", index)` → `activateTab` |
| Shortcuts: Cmd+K command center | Dispatches `pi:command-center:open` DOM event |
| Shortcuts: Cmd+B toggle sidebar | `navStore.setSidebarCollapsed` |

## Build & test results

```
$ npx tsc -b packages/app   → no errors
$ npm test                   → 109 files, 1462 tests passed
```

## Acceptance criteria
- [x] Header shows real agent status, controls — `useWorkspaceHeaderData` provides `isAgentRunning`, `canStop`, `branch`
- [x] Sidebar lists real workspaces with status — `useSidebarData` maps workspace list + agent status
- [x] Keyboard shortcuts trigger actions — `useWorkspaceShortcuts` resolver + executor
- [x] Toggle sidebar shortcut works — `setSidebarCollapsed` tested
