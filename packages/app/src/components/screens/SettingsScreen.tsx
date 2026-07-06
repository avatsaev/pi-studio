/**
 * SettingsScreen — /settings root + /settings/:section + host settings.
 * View-model-driven with discriminated view (root / section / host / projects / project).
 * app-navigation-screens.md § Settings information architecture
 *
 * Paseo parity: centered 720 column, ScreenTitle, SettingsSection rhythm,
 * rows-in-a-card with a single top border between rows. docs/design.md §3,§5,§7.
 */

import { useMemo } from "react";
import { clsx } from "clsx";
import styles from "./SettingsScreen.module.css";
import { Switch } from "../primitives/index.js";
import { ScreenTitle } from "../primitives/ScreenTitle.js";
import { PageColumn, SettingsSection, Card, SettingsRow } from "./settings-kit.js";
import {
  resolveSettingsLayout,
  appSettingsItems,
  daemonModeToggle,
  shortcutHelpRows,
  type SettingsView,
} from "../../screens/settings.js";
import type { HostRuntimeSnapshot } from "../../runtime/host-runtime.js";
import type { OsFamily } from "../../ui/shortcut.js";

// ---------------------------------------------------------------------------
// Sub-sections — each is a SettingsSection + Card of rows.
// ---------------------------------------------------------------------------

const THEME_OPTIONS: { id: string; label: string }[] = [
  { id: "dark", label: "Dark" },
  { id: "light", label: "Light" },
  { id: "dim", label: "Dim" },
];

function AppearanceSection({ onThemeChange, activeTheme }: { onThemeChange: (variant: string) => void; activeTheme: string }) {
  return (
    <SettingsSection title="Appearance">
      <Card>
        <SettingsRow
          title="Theme"
          hint="Match your system or pick a fixed appearance."
          trailing={
            <div className={styles.segment} role="radiogroup" aria-label="Theme">
              {THEME_OPTIONS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="radio"
                  aria-checked={activeTheme === t.id}
                  className={clsx(styles.segmentBtn, activeTheme === t.id && styles.segmentBtnActive)}
                  onClick={() => onThemeChange(t.id)}
                >
                  {t.label}
                </button>
              ))}
            </div>
          }
        />
      </Card>
    </SettingsSection>
  );
}

function GeneralSection() {
  return (
    <SettingsSection title="General">
      <Card>
        <SettingsRow title="Language" trailing="English" />
      </Card>
    </SettingsSection>
  );
}

function DaemonSection({ currentMode, onToggle }: { currentMode: "embedded" | "remote-only"; onToggle: (next: "embedded" | "remote-only") => void }) {
  const result = daemonModeToggle({ currentMode, embeddedIsOnlyHost: false });
  return (
    <SettingsSection title="Daemon">
      <Card>
        <SettingsRow
          title="Embedded daemon"
          hint={currentMode === "embedded" ? "Running a local daemon on this device." : "Connecting to remote hosts only."}
          trailing={<Switch checked={currentMode === "embedded"} onCheckedChange={() => onToggle(result.nextMode)} />}
        />
      </Card>
    </SettingsSection>
  );
}

function ShortcutsSection({ os }: { os: OsFamily }) {
  const rows = shortcutHelpRows(os);
  return (
    <SettingsSection title="Keyboard shortcuts">
      <Card>
        {rows.slice(0, 20).map((r) => (
          <SettingsRow key={r.id} title={r.id} trailing={<kbd className={styles.kbd}>{r.combo}</kbd>} />
        ))}
      </Card>
    </SettingsSection>
  );
}

function ProviderUsageSection({ available }: { available: boolean }) {
  return (
    <SettingsSection title="Provider usage">
      <Card>
        {available ? (
          <SettingsRow title="Usage" hint="Loading usage data…" />
        ) : (
          <SettingsRow title="Usage" hint="Provider usage data is not available from this host." />
        )}
      </Card>
    </SettingsSection>
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

function sectionTitle(view: SettingsView): string {
  if (view.kind === "section") return view.section.charAt(0).toUpperCase() + view.section.slice(1).replace(/-/g, " ");
  if (view.kind === "projects") return "Projects";
  if (view.kind === "project") return "Project";
  if (view.kind === "host") return "Host";
  return "Settings";
}

export function SettingsScreen({
  path,
  width,
  isDesktop,
  isElectron,
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
    if (view.kind === "root") {
      return (
        <SettingsSection title="App">
          <Card>
            {appItems.map((item) => (
              <SettingsRow key={item.id} title={item.label} onClick={() => onNavigate(item.route)} trailing={<span className={styles.chevron}>›</span>} />
            ))}
          </Card>
        </SettingsSection>
      );
    }
    if (view.kind === "section") {
      switch (view.section) {
        case "appearance": return <AppearanceSection activeTheme={activeTheme} onThemeChange={onThemeChange} />;
        case "general": return <GeneralSection />;
        case "daemon": return isElectron ? <DaemonSection currentMode={daemonMode} onToggle={(m) => onDaemonModeToggle?.(m)} /> : null;
        case "shortcuts": return <ShortcutsSection os={os} />;
        case "integrations": return <ProviderUsageSection available={false} />;
        default:
          return (
            <SettingsSection title={view.section}>
              <Card><SettingsRow title="Coming soon" hint="This section is not yet available." /></Card>
            </SettingsSection>
          );
      }
    }
    if (view.kind === "projects") return <SettingsSection title="Projects"><Card><SettingsRow title="No projects" hint="Registered projects will appear here." /></Card></SettingsSection>;
    if (view.kind === "project") return <SettingsSection title="Project"><Card><SettingsRow title={view.projectKey} /></Card></SettingsSection>;
    if (view.kind === "host") return <SettingsSection title="Host"><Card><SettingsRow title={view.serverId} hint={view.section} /></Card></SettingsSection>;
    return null;
  };

  // Compact root: show the section list only.
  if (layout.mode === "compact" && layout.view.kind === "root") {
    return (
      <div className={styles.container}>
        <div className={styles.body}>
          <PageColumn>
            <ScreenTitle>Settings</ScreenTitle>
            <div className={styles.titleGap} />
            {renderSection(layout.view)}
          </PageColumn>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      {layout.mode === "wide" && (
        <nav className={styles.sidebar}>
          <span className={styles.navGroupLabel}>App</span>
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

      <div className={styles.body}>
        <PageColumn>
          <ScreenTitle>{sectionTitle(layout.view)}</ScreenTitle>
          <div className={styles.titleGap} />
          {renderSection(layout.view)}
        </PageColumn>
      </div>
    </div>
  );
}
