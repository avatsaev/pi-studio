/**
 * CommandCenter — global fuzzy-search command palette.
 * Consumes sprint-013 command-center view model.
 * app-navigation-screens.md § Command center
 */

import { useState, useEffect, useRef, useReducer } from "react";
import { useNavigate } from "react-router";
import { Search } from "lucide-react";
import { clsx } from "clsx";
import styles from "./CommandCenter.module.css";
import { Portal } from "../overlays/Portal.js";
import { StatusDot } from "../primitives/StatusDot.js";
import {
  commandCenterItems,
  commandCenterReducer,
  activateCommandCenterItem,
  type CommandCenterAgent,
  type CommandCenterItem,
} from "../../screens/command-center.js";

export interface CommandCenterProps {
  open: boolean;
  onClose: () => void;
  agents: readonly CommandCenterAgent[];
}

export function CommandCenter({ open, onClose, agents }: CommandCenterProps) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [state, dispatch] = useReducer(commandCenterReducer, {
    open: false,
    highlightedIndex: 0,
  });
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus search when opened.
  useEffect(() => {
    if (open) {
      setQuery("");
      dispatch({ type: "OPEN" });
      setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [open]);

  const items = commandCenterItems({ agents, query });

  function activate(item: CommandCenterItem) {
    const { route } = activateCommandCenterItem(item);
    navigate(route);
    onClose();
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      dispatch({ type: "ARROW_DOWN", itemCount: items.length });
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      dispatch({ type: "ARROW_UP", itemCount: items.length });
    } else if (e.key === "Enter") {
      const item = items[state.highlightedIndex];
      if (item) activate(item);
    } else if (e.key === "Escape") {
      onClose();
    }
  }

  if (!open) return null;

  return (
    <Portal>
      <div className={styles.backdrop} onClick={onClose} role="dialog" aria-modal aria-label="Command center">
        <div
          className={styles.panel}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={handleKey}
        >
          {/* Search bar */}
          <div className={styles.searchBar}>
            <Search size={16} color="var(--pi-color-foregroundMuted)" aria-hidden />
            <input
              ref={inputRef}
              className={styles.searchInput}
              placeholder="Search agents, actions…"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                dispatch({ type: "ARROW_DOWN", itemCount: 0 }); // reset highlight
              }}
              aria-label="Search"
              role="combobox"
              aria-expanded={open}
            />
          </div>

          {/* Results */}
          <div className={styles.list} role="listbox">
            {items.length === 0 ? (
              <div className={styles.empty}>No results</div>
            ) : (
              items.map((item, i) => (
                <button
                  key={item.kind === "agent" ? item.agent.agentId : item.action.id}
                  className={clsx(
                    styles.item,
                    i === state.highlightedIndex && styles.itemHighlighted,
                  )}
                  role="option"
                  aria-selected={i === state.highlightedIndex}
                  onClick={() => activate(item)}
                  onMouseEnter={() => {
                    /* update highlight on hover */
                  }}
                >
                  {item.kind === "agent" && (
                    <StatusDot status={item.agent.status} requiresAttention={item.agent.requiresAttention} />
                  )}
                  <span className={styles.itemLabel}>{item.label}</span>
                  {item.kind === "agent" && item.agent.cwd && (
                    <span className={styles.itemMeta}>{item.agent.cwd}</span>
                  )}
                </button>
              ))
            )}
          </div>
        </div>
      </div>
    </Portal>
  );
}
