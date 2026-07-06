/**
 * SettingsScreen — /settings root + /settings/:section + host settings.
 * View-model-driven with discriminated view (root / section / host / projects / project).
 * app-navigation-screens.md § Settings information architecture
 */

import { useMemo } from "react";
import { clsx } from "clsx";
import styles from "./SettingsScreen.module.css";
import { Button, Switch } from "../primitives/index.js";
import {
  resolveSettingsLayout,
  resolveSettingsView,
  appSettingsItems,
  hostPickerRows,
  hostSettingsItems,
  daemonModeToggle,
  shortcutHelpRows,
  type SettingsView,
  type SettingsSidebarItem,
} from "../../screens/settings.js";
import type { HostRuntimeSnapshot } from "../../runtime/host-runtime.js";
import type { OsFamily } from "../../ui/shortcut.js";

// ---------------------------------------------------------------------------
// Sub-sections
// ---------------------------------------------------------------------------

function AppearanceSection({ onThemeChange, activeTheme }: { onThemeChange: (variant: string) => void; activeTheme: string }) {
  const themes = ["dark", "light", "dim"];
  return (
    <div>
      <h2 className={styles.sectionTitle}>Appearance</h2>
      <div className={styles.field}>
        <span className={styles.fieldLabel}>Theme</span>
        <div className={styles.fieldRow}>
          {themes.map((t) => (
            <div
              key={t}
              className={clsx(styles.swatch, activeTheme === t && styles.swatchActive)}
              style={{ backgroundColor: t === "dark" ? "#09090b" : t === "light" ? "#ffffff" : "#18181b" }}
              onClick={() => onThemeChange(t)}
              role="button"
              tabIndex={0}
              aria-label={t}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function GeneralSection() {
  return (
    <div>
      <h2 className={styles.sectionTitle}>General</h2>
      <div className={styles.field}>
        <span className={styles.fieldLabel}>Language</span>
        <span style={{ fontSize: 13, color: "var(--pi-color-foreground)" }}>English</span>
      </div>
    </div>
  );
}

function DaemonSection({ currentMode, onToggle }: { currentMode: "embedded" | "remote-only"; onToggle: (next: "embedded" | "remote-only") => void }) {
  const result = daemonModeToggle({ currentMode, embeddedIsOnlyHost: false });
  return (
    <div>
      <h2 className={styles.sectionTitle}>Daemon</h2>
      <div className={styles.field}>
        <span className={styles.fieldLabel}>Mode</span>
        <div className={styles.fieldRow}>
          <Switch
            checked={currentMode === "embedded"}
            onCheckedChange={() => onToggle(result.nextMode)}
          />
          <span style={{ fontSize: 13, color: "var(--pi-color-foreground)" }}>
            {currentMode === "embedded" ? "Embedded (local)" : "Remote only"}
          </span>
        </div>
      </div>
    </div>
  );
}

function ShortcutsSection({ os }: { os: OsFamily }) {
  const rows = shortcutHelpRows(os);
  return (
    <div>
      <h2 className={styles.sectionTitle}>Keyboard Shortcuts</h2>
      <table className={styles.table}>
        <thead>
          <tr><th>Action</th><th>Shortcut</th></tr>
        </thead>
        <tbody>
          {rows.slice(0, 20).map((r) => (
            <tr key={r.id}><td>{r.id}</td><td>{r.combo}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ProviderUsageSection({ available }: { available: boolean }) {
  if (!available) {
    return (
      <div>
        <h2 className={styles.sectionTitle}>Provider Usage</h2>
        <p style={{ fontSize: 13, color: "var(--pi-color-foregroundMuted)" }}>
          Provider usage data is not available from this host.
        </p>
      </div>
    );
  }
  return (
    <div>
      <h2 className={styles.sectionTitle}>Provider Usage</h2>
      <table className={styles.table}>
        <thead><tr><th>Provider</th><th>Tokens</th><th>Requests</th></tr></thead>
        <tbody>
          <tr><td colSpan={3} style={{ color: "var(--pi-color-foregroundMuted)" }}>Loading…</td></tr>
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export interface SettingsScreenProps {
  path: string;
  width: number;
  isDesktop: boolean;
  isElectron: boolean;
  hosts: readonly HostRuntimeSnapshot[];
  activeTheme: string;
  os: OsFamily;
  daemonMode?: "embedded" | "remote-only";
  onNavigate: (route: string) => void;
  onThemeChange: (variant: string) => void;
  onDaemonModeToggle?: (mode: "embedded" | "remote-only") => void;
}

export function SettingsScreen({
  path,
  width,
  isDesktop,
  isElectron,
  hosts,
  activeTheme,
  os,
  daemonMode = "embedded",
  onNavigate,
  onThemeChange,
  onDaemonModeToggle,
}: SettingsScreenProps) {
  const layout = useMemo(() => resolveSettingsLayout({ path, width, isDesktop }), [path, width, isDesktop]);
  const appItems = useMemo(() => appSettingsItems(isDesktop), [isDesktop]);

  const renderSection = (view: SettingsView) => {
    if (view.kind === "root") return null;
    if (view.kind === "section") {
      switch (view.section) {
        case "appearance": return <AppearanceSection activeTheme={activeTheme} onThemeChange={onThemeChange} />;
        case "general": return <GeneralSection />;
        case "daemon": return isElectron ? <DaemonSection currentMode={daemonMode} onToggle={(m) => onDaemonModeToggle?.(m)} /> : null;
        case "shortcuts": return <ShortcutsSection os={os} />;
        default: return <div><h2 className={styles.sectionTitle}>{view.section}</h2></div>;
      }
    }
    if (view.kind === "projects") return <div><h2 className={styles.sectionTitle}>Projects</h2></div>;
    if (view.kind === "project") return <div><h2 className={styles.sectionTitle}>Project: {view.projectKey}</h2></div>;
    if (view.kind === "host") return <div><h2 className={styles.sectionTitle}>Host: {view.serverId} / {view.section}</h2></div>;
    return null;
  };

  // Compact: show sidebar OR content, not both
  if (layout.mode === "compact" && layout.view.kind === "root") {
    return (
      <div className={styles.container}>
        <div className={styles.sidebarCompact}>
          <span className={styles.groupLabel}>App</span>
          {appItems.map((item) => (
            <button key={item.id} className={styles.navItem} onClick={() => onNavigate(item.route)}>
              {item.label}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      {/* Sidebar (wide only) */}
      {layout.mode === "wide" && (
        <nav className={styles.sidebar}>
          <span className={styles.groupLabel}>App</span>
          {appItems.map((item) => (
            <button
              key={item.id}
              className={clsx(styles.navItem, layout.view.kind === "section" && layout.view.section === item.id && styles.navItemActive)}
              onClick={() => onNavigate(item.route)}
            >
              {item.label}
            </button>
          ))}
        </nav>
      )}

      {/* Content */}
      <div className={styles.content}>
        {renderSection(layout.view)}
      </div>
    </div>
  );
}
