# Task 001 — Tab model, panel registry & reconciliation — Summary

- **Sprint:** sprint-014-workspace-shell
- **Completed:** 2026-07-05
- **Status:** done

## What was implemented

Implemented the workspace tab target model, deterministic tab ids, target equality, draft→agent
retargeting, pure metadata panel registry, pane/focus context contracts, backend reconciliation, and
subagent tab close/archive policy.

## Files created / changed

| File | Change |
|------|--------|
| `packages/app/src/workspace/tabs.ts` | created tab target/types, deterministic ids, equality, open/refocus, retarget, labels |
| `packages/app/src/workspace/panel-registry.ts` | created kind→panel metadata registry, descriptors, pane/focus context contracts |
| `packages/app/src/workspace/reconciliation.ts` | created de-dupe/prune/auto-open/pin-hide reconciliation helpers |
| `packages/app/src/workspace/subagents.ts` | created subagent track and close/archive policy helpers |
| `packages/app/src/workspace/index.ts` | created workspace barrel export |
| `packages/app/src/workspace/tabs-reconciliation.test.ts` | added 11 tests |
| `packages/app/src/index.ts` | exports workspace module |

## How it satisfies the scope

- Six tab kinds are modeled with deterministic ids and descriptors that drive label/icon/status/title state.
- Re-opening an existing target returns the existing tab/focus target; draft setup participates in equality.
- Retargeting mutates a draft position into an agent tab while preserving order/created time.
- Reconciliation de-dupes tabs, prunes stale/archived agent and terminal tabs only after hydration, adds
  missing auto-open agents/standalone terminals, and applies per-client pin/hide sets.
- Subagent tab closing is layout-only; root-agent tab closing archives globally; explicit subagent archive
  action remains distinct.

## Build & test results

```
$ npx vitest run packages/app/src/workspace/tabs-reconciliation.test.ts
 ✓ packages/app/src/workspace/tabs-reconciliation.test.ts (11 tests) 4ms

$ npm --workspace @av-pi-studio/app run typecheck
 success

$ npm run build
 success
```

## Acceptance criteria

- [x] Re-opening an existing target re-focuses; draft tab becomes an agent tab in place.
- [x] Reconciliation de-dups, prunes archived/stale tabs after hydration, and auto-opens expected tabs.
- [x] Pin forces visible; hide suppresses; both are per-client inputs.
- [x] Subagent layout-only vs root-agent global archive policy is implemented and tested.

## Follow-ups / TODO(verify)

- Runtime division between a future visual layout store and flat tab store remains TODO(verify) per scope;
  this task provides pure contracts/operations for that store.
