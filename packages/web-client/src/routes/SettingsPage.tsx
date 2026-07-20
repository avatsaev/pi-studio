/**
 * SettingsPage — client-side settings. "Servers" manages saved daemon connections
 * (persisted in localStorage via `stores/saved-servers-store.ts`). "Providers" is a
 * placeholder: registering LLM providers (API keys / models) needs daemon-side endpoints
 * that do not exist yet — the daemon reads `config.json` once at boot, never writes it,
 * and is deliberately credential-blind (Pi authenticates on the daemon host itself).
 * That flow is a separate ticket touching the daemon + protocol before any UI lands.
 */

import { Link } from "react-router";
import { ArrowLeft } from "lucide-react";
import { ScreenTitle } from "@pi-studio-ui/components/primitives/ScreenTitle.js";
import { Surface } from "@pi-studio-ui/components/primitives/Surface.js";
import { ConnectionStatus } from "@pi-studio-ui/features/connection/ConnectionStatus.js";
import { SavedServersSection } from "@pi-studio-ui/features/settings/SavedServersSection.js";
import styles from "./SettingsPage.module.css";

export function SettingsPage() {
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <span className={styles.brand}>Pi-Studio</span>
        <ConnectionStatus />
        <Link to="/" className={styles.backLink}>
          <ArrowLeft size={14} aria-hidden /> Workspace
        </Link>
      </header>

      <div className={styles.content}>
        <ScreenTitle>Settings</ScreenTitle>

        <SavedServersSection />

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Providers</h2>
          <Surface className={styles.placeholder}>
            <p className={styles.placeholderText}>
              LLM provider registration (API keys, models) requires daemon support that doesn&apos;t
              exist yet: the daemon currently reads its config once at boot and offers no config or
              credential endpoints — Pi authenticates on the daemon host itself. This section lands
              with the upcoming daemon config-API ticket.
            </p>
          </Surface>
        </section>
      </div>
    </div>
  );
}
