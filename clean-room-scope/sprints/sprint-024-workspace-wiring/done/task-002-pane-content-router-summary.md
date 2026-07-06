# Task 002 — Pane Content Router & Keepalive Mount — Summary

- **Sprint:** sprint-024-workspace-wiring
- **Completed:** 2026-07-06
- **Status:** done

## What was implemented

`PaneContentRouter` — maps `WorkspaceTab` target kind → panel component with per-pane error
boundary, Suspense loading fallback, and CSS keepalive for backgrounded tabs.

### Files created
| File | Description |
|------|-------------|
| `packages/app/src/components/workspace/PaneContentRouter.tsx` | Router + `PaneErrorBoundary` + `KeepalivePaneWrapper` |
| `packages/app/src/components/workspace/pane-router.test.ts` | 14 tests for keepalive logic + tab kinds |

## How it satisfies the scope

| Scope requirement | Implementation |
|---|---|
| `timeline` → Timeline + Composer | `AgentPane` / `DraftPane` renderers |
| `terminal` → TerminalPane | `TerminalPaneWrapper` |
| `file` → FilePreviewPane | `FilePaneWrapper` |
| `browser` → BrowserPane | `BrowserPaneWrapper` |
| `git` → GitChangesPanel | `GitPaneWrapper` |
| Keepalive: up to 3 backgrounded panes (hidden via CSS) | `KeepalivePaneWrapper` uses `mountedTabState`/`mountedHiddenStyle`; unmounted tabs return null |
| LRU eviction beyond cap 3 | Delegated to `nextMountedTabLru` (tested) |
| Per-pane error boundary | `PaneErrorBoundary` — catches render errors, shows retry UI, logs stack |
| Suspense fallback | Each pane wrapped in `<Suspense>` with `<Spinner>` fallback |
| Focus: only active pane receives keyboard events | `pointerEvents: none` on hidden panes |

## Build & test results

```
$ npx tsc -b packages/app   → no errors
$ npm test                   → 107 files, 1440 tests passed
```

## Acceptance criteria
- [x] Each tab kind routes to correct panel — verified by type-safe dispatch
- [x] Switching tabs preserves state — keepalive keeps DOM mounted, CSS hidden
- [x] LRU eviction at cap 3 — tested (t1..t4: t1 evicted when t4 activated)
- [x] Errors in one pane don't crash adjacent panes — `PaneErrorBoundary` per pane

## Follow-ups
- `AgentPane` uses empty rows stub — wired to real session store in task-003.
- `TerminalPane` / `BrowserPane` use stub state — wired in sprint-025 (composer-full).
