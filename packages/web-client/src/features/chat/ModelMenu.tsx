/**
 * ModelMenu — composer toolbar control (sprint-043). A ghost trigger button shows the session's
 * current model (or a placeholder before one is known); clicking it opens an anchored dropdown
 * listing the provider's models with a fuzzy search filter at the top. The current model sorts
 * first with a checkmark; every row renders `label (id)` with the id in muted text.
 *
 * Anchoring follows `TabStrip.tsx`'s `NewTabMenu` visible-trigger pattern (`DropdownMenu.Trigger
 * asChild` wrapping a real `<Button>`), NOT `SessionContextMenu`'s invisible fixed-coordinate
 * trigger (that pattern is for right-click menus only). Search reuses the pure `filterOptions`
 * helper (case-insensitive substring on label + id) instead of a bespoke filter.
 */

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Check } from "lucide-react";
import { Button } from "@pi-studio-ui/components/primitives/Button.js";
import { Spinner } from "@pi-studio-ui/components/primitives/Spinner.js";
import { useConnectionStore } from "@pi-studio-ui/lib/connection/connection-store.js";
import { useProviderModels } from "@pi-studio-ui/hooks/use-provider-models.js";
import { filterOptions, type ComboboxOption } from "@pi-studio-ui/ui/combobox.js";
import { sortCurrentFirst, dedupeById } from "./model-menu-sort.js";
import styles from "./ModelMenu.module.css";

export interface ModelMenuProps {
  /** `session.model` — undefined for a brand-new session with no known model yet. */
  currentModel?: string;
  provider: string;
  /**
   * `modelProvider` is the model's OWN underlying LLM provider (e.g. `"anthropic"`) — REQUIRED
   * by `client.agent(id).setModel(provider, modelId)`'s `provider` argument. Never hardcode the
   * pi-studio provider (`"pi"`) here: Pi has no model registered under a provider literally
   * named "pi" (sprint-043's "Model not found: pi/<modelId>" bug).
   */
  onSelect: (modelId: string, modelProvider?: string) => void;
}

export function ModelMenu({ currentModel, provider, onSelect }: ModelMenuProps) {
  const client = useConnectionStore((s) => s.client);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  // Read-through cached by `[provider]` (`use-provider-models.ts`): once a session's model list
  // has been fetched once, reopening the menu shows it immediately (`isLoading: false`) instead
  // of a spinner every time, while TanStack Query refetches it in the background so it stays
  // current. Only fetches while the menu is actually open (`enabled: open`), matching
  // `OpenWorkspaceDialog.tsx`'s `useExplorer(path, open && ...)` convention.
  const {
    data: models = [],
    isLoading,
    isError,
    error,
  } = useProviderModels(provider, open);
  const sortedModels = dedupeById(sortCurrentFirst(models, currentModel));

  // Reset the search query and refocus the search input every time the menu opens.
  useEffect(() => {
    if (!open) return;
    setQuery("");
    searchRef.current?.focus();
  }, [open]);

  const providerById = new Map(sortedModels.map((m) => [m.id, m.provider]));
  const options: ComboboxOption<string>[] = sortedModels.map((m) => ({
    value: m.id,
    label: m.label ?? m.id,
    description: m.id,
  }));
  const filtered = filterOptions(options, query);
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
        <Button
          variant="ghost"
          size="md"
          className={styles.modelBtn}
          disabled={!client}
          title={currentModel ? `Model: ${currentModel}` : "Select model"}
        >
          {currentModel ?? "Model"}
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className={styles.content} align="start" sideOffset={4}>
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
          {!isLoading && !isError && filtered.length === 0 && (
            <div className={styles.state}>No models found</div>
          )}
          {!isLoading && !isError && filtered.length > 0 && (
            <div className={styles.list}>
              {filtered.map((opt) => (
                <DropdownMenu.Item
                  key={opt.value}
                  className={styles.item}
                  onSelect={() => onSelect(opt.value, providerById.get(opt.value))}
                >
                  <span className={styles.checkSlot} aria-hidden>
                    {opt.value === currentModel && <Check size={14} />}
                  </span>
                  <span className={styles.label}>{opt.label}</span>
                  <span className={styles.modelId}>({opt.value})</span>
                </DropdownMenu.Item>
              ))}
            </div>
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
