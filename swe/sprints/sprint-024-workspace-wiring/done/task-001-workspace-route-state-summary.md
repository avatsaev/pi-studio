# Task 001 — Workspace Route State & Tab Layout Store — Summary

- **Sprint:** sprint-024-workspace-wiring
- **Completed:** 2026-07-06
- **Status:** done

## What was implemented

Zustand workspace tab layout store with KV persistence and the `useWorkspaceRouteState` hook that resolves workspace gate states from URL params + session store.

### Files created
| File | Description |
|------|-------------|
| `packages/app/src/store/workspace-layout-store.ts` | Zustand store: open/close/reorder/split/move/resize tabs; stale detection; LRU keepalive; debounced KV save |
| `packages/app/src/hooks/use-workspace-route.ts` | `useWorkspaceRouteState` — resolves gate (loading/missing/ready) from URL + session store |
| `packages/app/src/util/uuid.ts` | Portable `randomUUID()` |
| `packages/app/src/store/workspace-layout-store.test.ts` | 14 tests |

## How it satisfies the scope

| Scope requirement | Implementation |
|---|---|
| Tab layout store (ordered tabs, split tree, active tab, pinned tabs) | `WorkspaceTabState` + all actions |
| Open/close/reorder/split/merge/resize | `openTab`, `closeTab`, `reorderTab`, `splitTab`, `moveTab`, `resizePanes` |
| Seed with timeline tab on first open | `initWorkspace` seeds agent or draft tab |
| Persist/restore to KV (debounced 400ms) | `scheduleSave` → `WorkspaceLayoutStore.save`; `initWorkspace` loads on boot |
| Stale tab detection | `markStale` / `clearStale` with reason string |
| LRU keepalive (cap 3) | `activateTab` calls `nextMountedTabLru`; eviction when >3 tabs active |
| Dedup open by target | `openTab` checks for existing matching target before creating |
| Route gate hook | `useWorkspaceRouteState` wraps `resolveWorkspaceRouteGate` with live data |

## Build & test results

```
$ npx tsc -b packages/app   → no errors
$ npm test                   → 106 files, 1426 tests passed
```

## Acceptance criteria
- [x] Tabs opened/closed/reordered; splits created/resized — all actions verified by tests
- [x] Layout persists across page refreshes — KV save/load tested
- [x] Stale tabs handled gracefully — markStale/clearStale tested
- [x] Initial seed includes timeline tab — verified by initWorkspace tests
- [x] Workspace not found shows gate view — `useWorkspaceRouteState` returns "missing" gate
