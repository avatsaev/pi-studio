/**
 * ModelMenu — model-selector trigger + anchored searchable picker (sprint-043; lives in the
 * composer's bottom toolbar). Renders a caller-supplied trigger element (`renderTrigger`, i.e.
 * `Composer.tsx`'s model-name + chevron button) that opens an anchored dropdown listing the
 * provider's models with a fuzzy search filter at the top, sectioned under one sticky header per
 * underlying LLM provider. The current model sorts first with a checkmark; every row renders
 * `label (id)` with the id in muted text, and `renderTrigger` gets that same name + id pair so
 * the closed trigger reads the same way the list does.
 *
 * Grouping is a shared mechanic, not a ModelMenu feature: `ui/option-groups.ts`'s `groupOptions`
 * sections any `ComboboxOption` list by its `group` field, and `MenuGroup` renders the header, so
 * any other picker built on the same primitives can group by whatever it likes. Here `group` is
 * the model's own provider (`"anthropic"`, `"openai"`, …) — the field that already had to travel
 * with every row for `setModel`. Headers render only once there are at least two of them: a
 * single-provider list is not clarified by one identical header above every row.
 *
 * Anchoring follows `TabStrip.tsx`'s `NewTabMenu` visible-trigger pattern (`DropdownMenu.Trigger
 * asChild` wrapping a real element), NOT `SessionContextMenu`'s invisible fixed-coordinate
 * trigger (that pattern is for right-click menus only). `align="end"` overrides `MenuContent`'s
 * `align="start"` default because this trigger sits at the RIGHT edge of the composer toolbar —
 * a start-aligned popup would hang off the panel's right side. Search reuses the pure
 * `filterOptions` helper (case-insensitive substring on label + id) instead of a bespoke filter;
 * a group whose every row is filtered out disappears with its header.
 */

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Check } from "lucide-react";
import { MenuContent, MenuGroup } from "@pi-studio-ui/components/primitives/Menu.js";
import { Spinner } from "@pi-studio-ui/components/primitives/Spinner.js";
import { useProviderModels } from "@pi-studio-ui/hooks/use-provider-models.js";
import { filterOptions, type ComboboxOption } from "@pi-studio-ui/ui/combobox.js";
import { groupOptions } from "@pi-studio-ui/ui/option-groups.js";
import { sortCurrentFirst, dedupeByModelKey } from "./model-menu-sort.js";
import styles from "./ModelMenu.module.css";

export interface ModelMenuProps {
  /** `session.model` — undefined for a brand-new session with no known model yet. */
  currentModel?: string;
  /**
   * `session.modelProvider` — the current model's own LLM provider. Hoists that provider's
   * section to the top of the list, and keeps the checkmark on the right row when two providers
   * offer the same model id. Undefined (a stream update that carried no provider) degrades to
   * id-only matching, exactly as before this field existed.
   */
  currentModelProvider?: string;
  provider: string;
  /**
   * `modelProvider` is the model's OWN underlying LLM provider (e.g. `"anthropic"`) — REQUIRED
   * by `client.agent(id).setModel(provider, modelId)`'s `provider` argument. Never hardcode the
   * pi-studio provider (`"pi"`) here: Pi has no model registered under a provider literally
   * named "pi" (sprint-043's "Model not found: pi/<modelId>" bug).
   */
  onSelect: (modelId: string, modelProvider?: string) => void;
  /** Renders the visible trigger element (must forward ref/props via `DropdownMenu.Trigger
   * asChild` — a real `<button>`/`Button`, not a fragment). Receives the current model's id and
   * its human-readable name from the fetched list (undefined until that list resolves, or when
   * the model is not in it at all), so the caller can render `Name (id)` styled however it
   * likes. */
  renderTrigger: (currentModel: string | undefined, currentModelLabel?: string) => ReactNode;
}

export function ModelMenu({
  currentModel,
  currentModelProvider,
  provider,
  onSelect,
  renderTrigger,
}: ModelMenuProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  // Read-through cached by `[provider]` (`use-provider-models.ts`): once a session's model list
  // has been fetched once, reopening the menu shows it immediately (`isLoading: false`) instead
  // of a spinner every time, while TanStack Query refetches it in the background so it stays
  // current. Enabled while the menu is open OR while a model is selected — the trigger labels
  // that model with its human-readable NAME, which only this list carries (`session.model` is
  // the bare id), so gating the fetch on `open` alone left a freshly reloaded composer showing a
  // bare id until the user happened to open the picker. One query key per provider, so every
  // pane in the app shares a single fetch rather than one each.
  const {
    data: models = [],
    isLoading,
    isError,
    error,
  } = useProviderModels(provider, open || currentModel !== undefined);

  // Reset the search query and refocus the search input every time the menu opens.
  useEffect(() => {
    if (!open) return;
    setQuery("");
    searchRef.current?.focus();
  }, [open]);

  const rows = dedupeByModelKey(sortCurrentFirst(models, currentModel, currentModelProvider));
  const options: ComboboxOption<string>[] = rows.map((m) => ({
    value: m.id,
    label: m.label ?? m.id,
    description: m.id,
    group: m.provider,
  }));
  // `sortCurrentFirst` hoisted the current model — provider-qualified when known — to index 0,
  // so this is the one option the checkmark belongs on and the one the trigger labels. Compared
  // by IDENTITY below, which is the only comparison that stays right when two providers offer
  // the same id and the session knows which one it is on.
  const first = options[0];
  const currentOption = first?.value === currentModel ? first : undefined;
  const groups = groupOptions(filterOptions(options, query), {
    priorityGroup: currentModelProvider,
    // Pi reports a provider for every model today; a future/custom entry without one gets an
    // honest header instead of silently joining whichever section rendered last.
    ungroupedLabel: "Other",
  });
  const showHeaders = groups.length > 1;
  const errorMessage = error instanceof Error ? error.message : "Failed to load models";

  // Radix's DropdownMenu.Content applies roving-focus typeahead to its Items; stop the search
  // input's keystrokes from bubbling there so typing filters instead of jumping to a matching item.
  function handleSearchKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    e.stopPropagation();
    if (e.key === "Escape") setOpen(false);
  }

  return (
    <DropdownMenu.Root open={open} onOpenChange={setOpen} modal={false}>
      <DropdownMenu.Trigger asChild>
        {renderTrigger(currentModel, currentOption?.label)}
      </DropdownMenu.Trigger>
      <MenuContent minWidth={240} align="end" sideOffset={6} className={styles.picker}>
        <input
          ref={searchRef}
          className={styles.search}
          placeholder="Search models…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleSearchKeyDown}
        />
        {isLoading && (
          <div className={styles.state}>
            <Spinner size="sm" />
          </div>
        )}
        {!isLoading && isError && <div className={styles.stateError}>{errorMessage}</div>}
        {!isLoading && !isError && groups.length === 0 && (
          <div className={styles.state}>No models found</div>
        )}
        {!isLoading && !isError && groups.length > 0 && (
          <div className={styles.list}>
            {groups.map((group) => (
              <MenuGroup key={group.key} label={showHeaders ? group.label : undefined}>
                {group.options.map((opt) => (
                  <DropdownMenu.Item
                    // Provider-qualified: the same id under two providers is two real rows.
                    key={`${opt.group ?? ""}/${opt.value}`}
                    className={styles.item}
                    onSelect={() => onSelect(opt.value, opt.group)}
                  >
                    <span className={styles.checkSlot} aria-hidden>
                      {opt === currentOption && <Check size={14} />}
                    </span>
                    <span className={styles.label}>{opt.label}</span>
                    <span className={styles.modelId}>({opt.value})</span>
                  </DropdownMenu.Item>
                ))}
              </MenuGroup>
            ))}
          </div>
        )}
      </MenuContent>
    </DropdownMenu.Root>
  );
}
