# Task 003 — Build the `ModelMenu` component (button + searchable picker)

- **Sprint:** sprint-043-model-selector
- **Status:** done
- **Estimated size:** M
- **Depends on:** task-002

## Goal
Create a self-contained `ModelMenu` component: a ghost trigger button showing the current model, and
an anchored popup listing the provider's models with a fuzzy search filter, a checkmark on the
selected model (sorted first), and each row showing the label with the model id in muted parentheses.

## Background / why
No existing primitive combines a trigger button + anchored menu + search + checkmark rows, so this
is purpose-built — but it reuses established patterns rather than inventing new ones. The design
system provides a Radix `DropdownMenu` visible-trigger pattern, a pure fuzzy-filter helper, a
checkmark idiom, and theme tokens; this task composes them.

## Scope references
- `clean-room-scope/features/composer-ui.md` § toolbar controls
- `clean-room-scope/features/provider-usage.md` § model selection UI
- `clean-room-scope/architecture/design-system.md` § tokens (`--pi-*`), § menus/dropdowns
- `packages/web-client/AGENTS.md` § features/chat, § components/primitives

## What to build
- **`packages/web-client/src/features/chat/ModelMenu.tsx`** with props:
  ```ts
  interface ModelMenuProps {
    currentModel?: string;              // session.model (may be undefined for a fresh session)
    provider: string;                   // "pi"
    onSelect: (modelId: string) => void;
  }
  ```
  - **Anchoring:** copy `TabStrip.tsx`'s `NewTabMenu` visible-trigger pattern
    (`packages/web-client/src/features/workspace/TabStrip.tsx:93-119`):
    `import * as DropdownMenu from "@radix-ui/react-dropdown-menu"` →
    `<DropdownMenu.Root>` → `<DropdownMenu.Trigger asChild>` wrapping a real
    `<Button variant="ghost" size="md" className={styles.modelBtn}>` → `<DropdownMenu.Portal>`
    `<DropdownMenu.Content align="start" sideOffset={4}>`. Do **NOT** copy `SessionContextMenu`'s
    invisible fixed-coordinate trigger (that is only for right-click menus).
  - **Trigger label:** `currentModel ?? "Model"` (placeholder when unknown), CSS-truncated.
  - **Data fetch:** on open, call `client.providers.listModels(provider)` (task-002); manage local
    `{ models, loading, error }`. Show `Spinner` (existing primitive) while loading, an inline muted
    error line on failure, and the list when loaded. Refetch on each open.
  - **Search filter:** reuse `filterOptions` from `packages/web-client/src/ui/combobox.ts`
    (case-insensitive substring on label + description). Map each model to
    `{ value: model.id, label: model.label ?? model.id, description: model.id }` so search matches
    both label and id. Keep a `query` state driven by a controlled `<input className={styles.search}>`
    at the top of the menu content.
  - **Ordering:** the model whose id === `currentModel` sorts **first**; the rest keep server order.
    Apply the sort before filtering.
  - **Rows:** each is a `<DropdownMenu.Item onSelect={() => onSelect(model.id)}>` containing:
    a fixed-width check slot (`<Check size={14} />` from `lucide-react` when
    `model.id === currentModel`, empty spacer otherwise — mirrors `Checkbox.tsx`'s check idiom),
    then `<span className={styles.label}>{label}</span>`, then
    `<span className={styles.modelId}>({model.id})</span>`.
  - **Search-input keystrokes:** Radix `DropdownMenu.Content` applies typeahead focus management;
    put `onKeyDown={(e) => e.stopPropagation()}` on the search input and focus it on open via a ref
    + `useEffect` (and `onCloseAutoFocus` as needed) so typing filters instead of triggering
    typeahead. If Radix still swallows keystrokes, render the search input as a non-`Item` element
    inside `Content` and rely on the stop-propagation interception.
  - Obtain the `client` handle via the same accessor the composer/other chat features already use
    (confirm and reuse verbatim — do not open a new connection).

## Out of scope
- Mounting into the composer and the select→setModel wiring (task-004).
- Changing agent-creation to seed the chosen model (not in this sprint).

## Acceptance criteria
- [ ] Trigger renders a ghost button showing `currentModel` or the `"Model"` placeholder.
- [ ] Opening the menu fetches and lists the provider's models; loading shows a spinner, failure an
      inline muted error.
- [ ] A search input at the top filters the list case-insensitively by label **and** id.
- [ ] The current model sorts first and shows a checkmark; other rows show an aligned empty slot.
- [ ] Each row shows `label` then `(id)` with the id in `--pi-color-foregroundMuted`.
- [ ] Selecting a row calls `onSelect(model.id)` and closes the menu.
- [ ] `npm run build:web-client` and `npm run typecheck` pass.

## Test / verification plan
- If the "current model sorts first" ordering is extracted into a pure helper, add a Vitest case
  asserting the selected id is at index 0 and that a query still matches by id.
- `ModelMenu.test.tsx` (mock `client.providers.listModels`): asserts placeholder label, checkmark on
  the current model, muted `(id)` rendering, case-insensitive filtering by label and id, and that
  selecting a row invokes `onSelect` with the right id. Run:
  `npx vitest run packages/web-client/src/features/chat/ModelMenu.test.tsx`.
- Manual: covered end-to-end in task-005.

## Notes
- `lucide-react` and `@radix-ui/react-dropdown-menu` are already dependencies — add nothing.
- Use `--pi-*` theme vars exclusively for color (`--pi-color-foregroundMuted` for the id text) so the
  menu tracks theme changes.
