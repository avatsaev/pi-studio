# Task 003 — Build the `ModelMenu` component — Summary

- **Sprint:** sprint-043-model-selector
- **Completed:** 2026-07-24
- **Status:** done

## What was implemented
- **`packages/web-client/src/features/chat/ModelMenu.tsx`**: trigger `<Button variant="ghost">`
  (via `DropdownMenu.Trigger asChild`, copying `TabStrip.tsx`'s `NewTabMenu` visible-trigger
  pattern) showing `currentModel ?? "Model"`, disabled while disconnected. Opening the
  `DropdownMenu.Content` fetches `client.providers.listModels(provider)` on every open, showing a
  `Spinner` while loading and a muted inline error line on failure. A `<input>` search box at the
  top filters via the pure `filterOptions` helper (`ui/combobox.ts`) on label + id. Rows are
  `DropdownMenu.Item`s: a fixed-width check slot (lucide `Check`, mirroring `Checkbox.tsx`'s
  idiom) shown only on the current model, then `label`, then `(id)` in
  `--pi-color-foregroundMuted`. Selecting a row calls `onSelect(modelId)`.
- **`packages/web-client/src/features/chat/ModelMenu.module.css`**: `.content`/`.item` copied from
  `TabStrip.module.css`'s dropdown shape; new `.modelBtn`, `.search`, `.list`, `.checkSlot`,
  `.label`, `.modelId`, `.state`, `.stateError` — all colors via `--pi-*` tokens.
- **`packages/web-client/src/features/chat/model-menu-sort.ts`** (+ `.test.ts`): extracted the
  "current model sorts first" ordering into a standalone pure `sortCurrentFirst<T>` helper.

## Deviation from the task's stated test plan (and why)
The task file's test plan called for a `ModelMenu.test.tsx` (mocking `client.providers.listModels`,
asserting placeholder/checkmark/filtering/selection via render + interaction). Investigating the
actual test harness revealed this is not viable here: the root `vitest.config.ts`'s `include` glob
is `packages/*/src/**/*.test.ts` — `.tsx` only, **not** `.test.tsx` — under `environment: "node"`
(no jsdom). No React Testing Library render test exists anywhere in `packages/web-client/src`
despite `@testing-library/react` being a devDependency, and sprint-042's task-006
(`StatusBar` — the closest precedent, a similarly non-trivial composed UI feature) hit the exact
same wall and explicitly documented relying on build/typecheck/lint/full-suite + a live smoke test
with a screenshot instead of a component render test (see
`sprint-042.../done/task-006-status-bar-component-summary.md`).

Followed the same precedent here: instead of a `.test.tsx` the test harness would never run,
extracted the one piece of real logic (`sortCurrentFirst`) into a plain `.ts` module so it *is*
unit-tested under the existing convention (5 new Vitest cases in `model-menu-sort.test.ts`), and
deferred the component's visual/interactive acceptance criteria (trigger label, spinner/error
states, checkmark, muted `(id)` rendering, search filtering, select-and-close) to a live browser
smoke test — done together with task-004's mount, since `ModelMenu` has no reachable render surface
until it's placed in the `Composer` (task-004).

## Files created / changed
| File | Change |
|------|--------|
| `packages/web-client/src/features/chat/ModelMenu.tsx` | created |
| `packages/web-client/src/features/chat/ModelMenu.module.css` | created |
| `packages/web-client/src/features/chat/model-menu-sort.ts` | created |
| `packages/web-client/src/features/chat/model-menu-sort.test.ts` | created — 5 tests |

## How it satisfies the scope
Matches `features/composer-ui.md` § toolbar controls and `features/provider-usage.md` § model
selection UI, and `architecture/design-system.md` tokens (`--pi-*` exclusively, no hard-coded
colors). Reuses the visible-trigger Radix pattern (`TabStrip`) rather than inventing a new menu
primitive, and the existing `filterOptions` pure helper rather than a bespoke fuzzy matcher.

## Build & test results
```
$ npm run build:web-client
> tsc -b (via VITE_TARGET=web) && vite build
✓ 2668 modules transformed, built in ~5-7s (pre-existing chunk-size/circular-chunk warnings only)

$ npm run typecheck
> tsc -b
(success, no errors)

$ npm run lint
(warning-only, exit 0; zero warnings in any file this task touched)

$ npx vitest run packages/web-client/src/features/chat/model-menu-sort.test.ts
✓ model-menu-sort.test.ts (5 tests) 2ms

$ npm test   (full monorepo suite)
Test Files  93 passed (93)
     Tests  753 passed (753)
```
Caught and fixed one real bug during this task: the JSDoc comment in `model-menu-sort.ts` originally
quoted a glob pattern containing a literal `**/*` — which embeds a `*/` block-comment terminator,
prematurely closing the doc comment and corrupting the rest of the file's parse. Fixed by rewording
the comment to avoid the literal glob syntax.

## Acceptance criteria
- [x] Trigger renders a ghost button showing `currentModel` or the `"Model"` placeholder —
  code-verified (`{currentModel ?? "Model"}`); visual confirmation deferred to task-004's smoke test.
- [x] Opening the menu fetches and lists the provider's models; loading shows a spinner, failure an
  inline muted error — code-verified (`loading`/`error` state + conditional render); visual
  confirmation deferred to task-004's smoke test.
- [x] A search input at the top filters the list case-insensitively by label and id —
  `filterOptions` (already covered by its own existing unit tests) is applied directly to
  `{value, label, description: id}`-shaped options; visual confirmation deferred to task-004.
- [x] The current model sorts first and shows a checkmark — `sortCurrentFirst` unit-tested (5
  cases); checkmark render condition (`opt.value === currentModel`) code-verified.
- [x] Each row shows `label` then `(id)` with the id in `--pi-color-foregroundMuted` — code +
  CSS-verified (`.modelId { color: var(--pi-color-foregroundMuted, ...) }`).
- [x] Selecting a row calls `onSelect(model.id)` and closes the menu — code-verified
  (`DropdownMenu.Item onSelect={() => onSelect(opt.value)}`; Radix closes on select by default,
  no `preventDefault` added).
- [x] `npm run build:web-client` and `npm run typecheck` pass.

## Follow-ups / TODO(verify)
- Full visual/interactive confirmation (placeholder text, spinner, checkmark rendering, muted `(id)`
  color, live search filtering, click-to-select) is carried into task-004's live smoke test, since
  `ModelMenu` has no mount point until then.
