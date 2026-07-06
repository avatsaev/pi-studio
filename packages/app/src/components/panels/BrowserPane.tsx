/**
 * BrowserPane — embedded browser (Electron webview) or web placeholder.
 * feature-panels-ui.md § browser pane
 */

import { useState, useCallback, useMemo } from "react";
import { ArrowLeft, ArrowRight, RotateCw, Globe } from "lucide-react";
import styles from "./BrowserPane.module.css";
import {
  type BrowserNavState,
  type BrowserPaneVariant,
  INITIAL_BROWSER_NAV,
  browserPaneVariant,
  unsupportedBrowserMessage,
  validateBrowserUrl,
  applyNavigation,
  browserDescriptorLabel,
} from "../../panels/browser-pane.js";

export interface BrowserPaneProps {
  isElectron: boolean;
  nav?: BrowserNavState;
  onNavigate?: (url: string) => void;
  onBack?: () => void;
  onForward?: () => void;
  onReload?: () => void;
}

export function BrowserPane({
  isElectron,
  nav = INITIAL_BROWSER_NAV,
  onNavigate,
  onBack,
  onForward,
  onReload,
}: BrowserPaneProps) {
  const variant = useMemo(() => browserPaneVariant(isElectron), [isElectron]);
  const [urlInput, setUrlInput] = useState(nav.url ?? "");

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    const validation = validateBrowserUrl(urlInput);
    if (validation.valid) {
      onNavigate?.(validation.normalized);
    }
  }, [urlInput, onNavigate]);

  if (variant === "unsupported") {
    return (
      <div className={styles.container}>
        <div className={styles.placeholder}>
          <Globe size={32} />
          <span>{unsupportedBrowserMessage()}</span>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.chrome}>
        <button className={styles.chromeBtn} disabled={!nav.canGoBack} onClick={onBack} aria-label="Back">
          <ArrowLeft size={14} />
        </button>
        <button className={styles.chromeBtn} disabled={!nav.canGoForward} onClick={onForward} aria-label="Forward">
          <ArrowRight size={14} />
        </button>
        <button className={styles.chromeBtn} onClick={onReload} aria-label="Reload">
          <RotateCw size={14} />
        </button>
        <form onSubmit={handleSubmit} style={{ flex: 1, display: "flex" }}>
          <input
            className={styles.urlInput}
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            placeholder="Enter URL…"
          />
        </form>
      </div>
      <div className={styles.webviewArea}>
        {/* Electron: <webview> injected via dynamic import; web: this area unused */}
        {nav.isLoading && <div style={{ padding: 16, color: "var(--pi-color-foregroundMuted)" }}>Loading…</div>}
        {nav.lastError && <div style={{ padding: 16, color: "var(--pi-color-statusDanger)" }}>{nav.lastError}</div>}
      </div>
    </div>
  );
}
