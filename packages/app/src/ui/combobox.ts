// Combobox — option building, filtering, and keyboard-navigation state machine.
// ui-components.md § Inputs & form controls (Combobox)
// The rendering surface (popover vs bottom-sheet) is handled by resolveOverlayMode
// from platform/overlay.ts. This module covers the pure logic.

export type ComboboxOption<T> = {
  value: T;
  label: string;
  description?: string;
  kind?: string;
  disabled?: boolean;
};

export type ComboboxState<T> = {
  query: string;
  highlightedIndex: number;
  isOpen: boolean;
  options: ComboboxOption<T>[];
  /** Filtered options (derived from options + query). */
  filtered: ComboboxOption<T>[];
};

// ---------------------------------------------------------------------------
// Option filtering
// ---------------------------------------------------------------------------

/**
 * Filter options by a search query (case-insensitive substring match on label
 * and optional description).
 */
export function filterOptions<T>(
  options: ComboboxOption<T>[],
  query: string,
): ComboboxOption<T>[] {
  if (query.trim() === "") return options;
  const q = query.toLowerCase();
  return options.filter(
    (o) =>
      o.label.toLowerCase().includes(q) ||
      (o.description !== undefined && o.description.toLowerCase().includes(q)),
  );
}

// ---------------------------------------------------------------------------
// Keyboard navigation
// ---------------------------------------------------------------------------

export type ComboboxAction =
  | { type: "OPEN" }
  | { type: "CLOSE" }
  | { type: "SET_QUERY"; query: string }
  | { type: "ARROW_DOWN" }
  | { type: "ARROW_UP" }
  | { type: "SELECT_HIGHLIGHTED" }
  | { type: "SELECT_INDEX"; index: number };

/**
 * Pure reducer for the combobox keyboard-navigation state machine.
 * Callers integrate this with their own state management.
 */
export function comboboxReducer<T>(
  state: ComboboxState<T>,
  action: ComboboxAction,
): ComboboxState<T> {
  switch (action.type) {
    case "OPEN":
      return { ...state, isOpen: true, highlightedIndex: 0 };

    case "CLOSE":
      return { ...state, isOpen: false, query: "", filtered: state.options };

    case "SET_QUERY": {
      const filtered = filterOptions(state.options, action.query);
      return {
        ...state,
        query: action.query,
        filtered,
        // Reset highlight when query changes; clamp to new filtered length.
        highlightedIndex: filtered.length > 0 ? 0 : -1,
      };
    }

    case "ARROW_DOWN": {
      if (!state.isOpen) return { ...state, isOpen: true, highlightedIndex: 0 };
      const count = state.filtered.length;
      if (count === 0) return state;
      // Skip disabled options.
      let next = (state.highlightedIndex + 1) % count;
      let guard = 0;
      while (state.filtered[next]?.disabled && guard < count) {
        next = (next + 1) % count;
        guard++;
      }
      return { ...state, highlightedIndex: next };
    }

    case "ARROW_UP": {
      if (!state.isOpen) return { ...state, isOpen: true, highlightedIndex: 0 };
      const count = state.filtered.length;
      if (count === 0) return state;
      let prev = (state.highlightedIndex - 1 + count) % count;
      let guard = 0;
      while (state.filtered[prev]?.disabled && guard < count) {
        prev = (prev - 1 + count) % count;
        guard++;
      }
      return { ...state, highlightedIndex: prev };
    }

    case "SELECT_HIGHLIGHTED": {
      // The actual selection callback is handled by the component; the reducer
      // just closes (or stays open if keepOpenOnSelect).
      return { ...state, isOpen: false, query: "", filtered: state.options };
    }

    case "SELECT_INDEX": {
      const idx = action.index;
      if (idx < 0 || idx >= state.filtered.length) return state;
      return { ...state, highlightedIndex: idx, isOpen: false, query: "", filtered: state.options };
    }
  }
}

/** Build initial combobox state for a given options list. */
export function initialComboboxState<T>(options: ComboboxOption<T>[]): ComboboxState<T> {
  return {
    query: "",
    highlightedIndex: 0,
    isOpen: false,
    options,
    filtered: options,
  };
}

// ---------------------------------------------------------------------------
// Custom-value option building
// ---------------------------------------------------------------------------

/**
 * If `allowCustomValue` is true and the query doesn't match any existing option
 * exactly (case-insensitive), prepend a synthetic "create" option to the filtered
 * list with the query string as the value.
 */
export function withCustomValueOption(
  filtered: ComboboxOption<string>[],
  query: string,
  prefix = "Create",
): ComboboxOption<string>[] {
  if (query.trim() === "") return filtered;
  const q = query.toLowerCase();
  const exactMatch = filtered.some((o) => o.label.toLowerCase() === q);
  if (exactMatch) return filtered;
  const synthetic: ComboboxOption<string> = {
    value: query,
    label: `${prefix} "${query}"`,
    kind: "custom",
  };
  return [synthetic, ...filtered];
}
