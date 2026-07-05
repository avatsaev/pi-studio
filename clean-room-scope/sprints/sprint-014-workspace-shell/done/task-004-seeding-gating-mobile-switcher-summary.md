# Task 004 — Empty-draft seeding, pinned quick-launch targets, route gating, mobile tab switcher — Summary

- **Sprint:** sprint-014-workspace-shell
- **Completed:** 2026-07-05
- **Status:** done

## What was implemented

Implemented empty-workspace draft seeding, `?open=` route-intent resolution, pinned quick-launch target
persistence/toggle/migration, route-gate state resolution, and compact/mobile switcher models.

## Files created / changed

| File | Change |
|------|--------|
| `packages/app/src/workspace/pinned-targets.ts` | created pinned target keying, migration, toggle, store, quick-launch mapping |
| `packages/app/src/workspace/seeding.ts` | created empty draft seeding and route `?open=` target resolution |
| `packages/app/src/workspace/route-gating.ts` | created workspace route gate state machine |
| `packages/app/src/workspace/mobile-switcher.ts` | created compact switcher entries/new actions/no-split model |
| `packages/app/src/workspace/seeding-gating-switcher.test.ts` | added 12 tests |
| `packages/app/src/workspace/index.ts` | exports task 004 modules |

## How it satisfies the scope

- Empty workspace seeding waits for route focus, persistence key, workspace dir, layout hydration, agent
  hydration, terminal hydration, and genuine zero tabs/agents/terminals before creating a draft composer tab.
- `?open=` intent resolution maps agent/terminal/file/draft/setup intents to workspace tab targets and
  focuses existing tabs before opening new targets or seeding a draft.
- Pinned quick-launch targets default to terminal + browser, use stable keys (`draft`, `terminal`,
  `browser`, `profile:<id>`), migrate old/empty shapes, persist through a client store, and expose Pin/Unpin
  menu labels plus one-tap launch target mapping.
- Route gating distinguishes ready, splash while tabs hydrate, reconnecting, unreachable, loading, missing,
  foreign-host redirect, and missing execution directory states.
- Mobile switcher exposes exactly one visible active tab, builds switcher entries with descriptor data,
  includes pinned new-tab actions, and never exposes split UI.

## Build & test results

```
$ npx vitest run packages/app/src/workspace/seeding-gating-switcher.test.ts
 ✓ packages/app/src/workspace/seeding-gating-switcher.test.ts (12 tests) 4ms

$ npm --workspace @av-pi-studio/app run typecheck
 success

$ npm run build
 success
```

## Acceptance criteria

- [x] Empty, fully hydrated workspaces seed a draft composer; `?open=` focuses/opens requested targets.
- [x] Pinned terminal/browser defaults render quick-launch targets, can be toggled, and persist across reloads.
- [x] Foreign/unknown workspace routes redirect or gate; splash is shown until tabs hydrate.
- [x] Compact/mobile shows one visible tab with switcher entries, new-tab actions, and no split UI.

## Follow-ups / TODO(verify)

- Exact future `?open=` vocabulary remains TODO(verify); this implementation consumes the current
  sprint-013 route grammar intents.
- Deleted pinned profile behavior remains TODO(verify) per scope; profile targets currently map to a draft
  seeded with the profile id as provider metadata for later composer integration.
