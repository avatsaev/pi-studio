/**
 * Select + Combobox — form selection controls.
 * Select = native <select> styled for theme consistency.
 * Combobox = filterable text input + dropdown list, consuming sprint-012 combobox model.
 * ui-components.md § Inputs & form controls
 */

import {
  forwardRef,
  useState,
  useRef,
  useEffect,
  type SelectHTMLAttributes,
  type ReactNode,
} from "react";
import { clsx } from "clsx";
import styles from "./Select.module.css";
import {
  filterOptions,
  comboboxReducer,
  initialComboboxState,
  type ComboboxState,
  type ComboboxOption,
  type ComboboxAction,
} from "@pi-studio-ui/ui/combobox.js";

// ---------------------------------------------------------------------------
// Native Select
// ---------------------------------------------------------------------------

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  options: { value: string; label: string }[];
  placeholder?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { options, placeholder, className, ...rest },
  ref,
) {
  return (
    <select ref={ref} className={clsx(styles.select, className)} {...rest}>
      {placeholder && (
        <option value="" disabled>
          {placeholder}
        </option>
      )}
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
});

// ---------------------------------------------------------------------------
// Combobox
// ---------------------------------------------------------------------------

export interface ComboboxProps {
  options: ComboboxOption<string>[];
  value?: string;
  onSelect?: (value: string) => void;
  placeholder?: string;
  className?: string;
}

export function Combobox({
  options,
  value,
  onSelect,
  placeholder = "Search…",
  className,
}: ComboboxProps) {
  const [state, setState] = useState<ComboboxState<string>>(() => initialComboboxState(options));
  const inputRef = useRef<HTMLInputElement>(null);

  function dispatch(action: ComboboxAction) {
    setState((prev) => comboboxReducer(prev, action));
  }

  function handleSelect(opt: ComboboxOption<string>) {
    onSelect?.(opt.value);
    dispatch({ type: "CLOSE" });
  }

  // Close on outside click
  const wrapperRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        dispatch({ type: "CLOSE" });
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  return (
    <div ref={wrapperRef} className={clsx(styles.comboboxWrapper, className)}>
      <input
        ref={inputRef}
        className={styles.comboboxInput}
        value={state.query}
        placeholder={placeholder}
        onChange={(e) => dispatch({ type: "SET_QUERY", query: e.target.value })}
        onFocus={() => dispatch({ type: "OPEN" })}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            dispatch({ type: "ARROW_DOWN" });
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            dispatch({ type: "ARROW_UP" });
          } else if (e.key === "Enter" && state.isOpen) {
            e.preventDefault();
            const opt = state.filtered[state.highlightedIndex];
            if (opt) handleSelect(opt);
          } else if (e.key === "Escape") {
            dispatch({ type: "CLOSE" });
          }
        }}
        role="combobox"
        aria-expanded={state.isOpen}
        aria-autocomplete="list"
      />
      {state.isOpen && state.filtered.length > 0 && (
        <div className={styles.comboboxList} role="listbox">
          {state.filtered.map((opt, i) => (
            <button
              key={opt.value}
              className={clsx(
                styles.comboboxOption,
                i === state.highlightedIndex && styles.comboboxOptionHighlighted,
              )}
              role="option"
              aria-selected={i === state.highlightedIndex}
              onMouseDown={(e) => {
                e.preventDefault();
                handleSelect(opt);
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
