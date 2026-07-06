/**
 * TerminalPane — xterm emulator tab, wired to terminal-stream router.
 * feature-panels-ui.md § terminal pane
 */

import { useEffect, useRef, useCallback, useState, useMemo } from "react";
import { clsx } from "clsx";
import styles from "./TerminalPane.module.css";
import {
  type TerminalPaneState,
  type TerminalResizePayload,
  type KeyBarKey,
  INITIAL_TERMINAL_PANE,
  MOBILE_KEY_BAR,
  shouldSendResize,
  shouldSendOutput,
  dedupResize,
  terminalDescriptorLabel,
  terminalStatusBucket,
} from "../../panels/terminal-pane.js";

export interface TerminalPaneProps {
  state: TerminalPaneState;
  /** Called to send input data to the server. */
  onInput?: (data: string) => void;
  /** Called to send resize to the server. */
  onResize?: (payload: TerminalResizePayload) => void;
  /** Whether this pane is focused + claiming (should send resize). */
  isClaiming?: boolean;
  /** Show compact key bar (mobile / touch). */
  showKeyBar?: boolean;
}

export function TerminalPane({
  state,
  onInput,
  onResize,
  isClaiming = false,
  showKeyBar = false,
}: TerminalPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const lastSizeRef = useRef<TerminalResizePayload | undefined>(undefined);
  const [activeModifiers, setActiveModifiers] = useState<Set<string>>(new Set());

  const status = useMemo(() => terminalStatusBucket(state), [state]);
  const label = useMemo(() => terminalDescriptorLabel(state), [state]);

  // Resize observer — debounced, dedup, only when claiming
  useEffect(() => {
    if (!isClaiming || !containerRef.current) return;
    const el = containerRef.current;
    let debounceTimer: ReturnType<typeof setTimeout>;

    const observer = new ResizeObserver(() => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        // Estimate cols/rows from container size + font metrics
        const rect = el.getBoundingClientRect();
        const cols = Math.floor(rect.width / 8); // ~8px per char mono
        const rows = Math.floor(rect.height / 18); // ~18px per line
        const next = { cols: Math.max(cols, 1), rows: Math.max(rows, 1) };
        if (dedupResize(lastSizeRef.current, next)) {
          lastSizeRef.current = next;
          onResize?.(next);
        }
      }, 100);
    });

    observer.observe(el);
    return () => { observer.disconnect(); clearTimeout(debounceTimer); };
  }, [isClaiming, onResize]);

  // Key bar key press
  const handleKeyPress = useCallback((key: KeyBarKey) => {
    if (key.isModifier) {
      setActiveModifiers((prev) => {
        const next = new Set(prev);
        if (next.has(key.label)) next.delete(key.label);
        else next.add(key.label);
        return next;
      });
    } else {
      // Build the sequence with active modifiers
      let seq = key.sequence;
      if (activeModifiers.has("Ctrl")) {
        // Ctrl + letter: send char code 1-26
        if (seq.length === 1 && /[a-z]/i.test(seq)) {
          seq = String.fromCharCode(seq.toUpperCase().charCodeAt(0) - 64);
        }
      }
      onInput?.(seq);
      setActiveModifiers(new Set());
    }
  }, [activeModifiers, onInput]);

  return (
    <div className={styles.container}>
      <div ref={containerRef} className={styles.terminalBody}>
        {/* xterm.js instance mounts here via ref in real integration */}
        {status === "failed" && (
          <div style={{ padding: 16, color: "var(--pi-color-statusDanger)" }}>Terminal disconnected</div>
        )}
      </div>

      {showKeyBar && (
        <div className={styles.keyBar}>
          {MOBILE_KEY_BAR.map((key) => (
            <button
              key={key.label}
              className={clsx(styles.keyBtn, activeModifiers.has(key.label) && styles.keyBtnActive)}
              onClick={() => handleKeyPress(key)}
            >
              {key.label}
            </button>
          ))}
        </div>
      )}

      <div className={styles.statusBar}>
        <span>{label}</span>
        <span>{status ?? "idle"}</span>
      </div>
    </div>
  );
}
