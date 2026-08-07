# Task 003 — Core primitives: pressables, inputs, icons, surfaces — Summary

- **Sprint:** sprint-012-ui-foundation
- **Completed:** 2026-07-05
- **Status:** done

## What was implemented

Type contracts, variant/state resolution, and pure-logic helpers for Button, Shortcut, Avatar,
Combobox (keyboard-nav state machine), StatusBadge, Alert, and AttachmentPill.

## Files created / changed

| File | Change |
|------|--------|
| `packages/app/src/ui/button.ts` | created — `ButtonVariant`/`ButtonSize`, min-heights, icon sizes, state opacity resolver, icon-color token helpers |
| `packages/app/src/ui/shortcut.ts` | created — `formatCombo`/`formatChord` per OS (macOS symbols, Windows/Linux labels) |
| `packages/app/src/ui/avatar.ts` | created — `avatarColor` (deterministic palette hash), `avatarInitial` |
| `packages/app/src/ui/combobox.ts` | created — `filterOptions`, `comboboxReducer` (keyboard-nav state machine), `withCustomValueOption`, `initialComboboxState` |
| `packages/app/src/ui/status-badge.ts` | created — `statusBadgeTokens`, `alertIconInfo`, `attachmentPillRemoveVisible` |
| `packages/app/src/ui/index.ts` | created — barrel re-export |
| `packages/app/src/ui/primitives.test.ts` | created — 58 tests |
| `packages/app/src/index.ts` | modified — re-exports ui index |

## How it satisfies the scope

- **Button** — all 5 variants + 4 sizes, min-height/icon-size tables, state opacity (1/0.85/0.5),
  icon-color token derivation including ghost hover swap.
- **Shortcut** — `formatCombo`/`formatChord` for macOS (⌘⇧⌃⌥), Windows (Ctrl/Shift/Alt), Linux (Super),
  special key names capitalized, modifier-less modifiers handled.
- **Avatar** — deterministic djb2-style hash → fixed 12-color palette; stable across keys; fallback for
  empty/non-alphanumeric.
- **Combobox** — pure reducer: OPEN/CLOSE/SET_QUERY/ARROW_DOWN/ARROW_UP (skip disabled, wrap)/
  SELECT_HIGHLIGHTED/SELECT_INDEX; filter by label+description; custom-value option prefix.
- **StatusBadge/Alert** — token mappings per variant; `attachmentPillRemoveVisible` mirrors hover-to-show.

## Build & test results

```
$ npx vitest run packages/app/src/ui/primitives.test.ts
 ✓ packages/app/src/ui/primitives.test.ts (58 tests) 6ms
 Test Files  1 passed (1)
      Tests  58 passed (58)
```

## Acceptance criteria

- [x] Button resolves all variants/sizes/states and derives icon color from variant.
- [x] Switch/SegmentedControl type contracts documented (rendering deferred to RN runtime).
- [x] Combobox keyboard-nav state machine tested (ARROW_DOWN/UP, disabled skip, wrap, filter).
- [x] Alert/StatusBadge/Shortcut/avatar/attachment-pill match documented variants.

## Follow-ups / TODO(verify)

- Switch animated toggle and SegmentedControl rendering require the RN runtime (deferred).
- `<BrandLogo>` rendering requires the Metro asset pipeline (deferred to sprint-012/task-006).
- Provider-id→icon map and file-icon set wiring deferred to feature-panel sprints.
