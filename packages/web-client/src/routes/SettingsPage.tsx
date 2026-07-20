/**
 * SettingsPage — list+detail shell (Paseo settings-shell pattern, docs/design.md §8):
 * a 320px sidebar holding the list (App sections + saved servers) beside a detail pane
 * with a 48px header (icon badge + ScreenTitle) and a centered max-720 reading column.
 * Selection is component state, derived safely during render — a stale server id (deleted
 * entry) falls back to the first server, then to Providers. No URL params: the settings
 * selection is not deep-linked.
 */

import { useState } from "react";
import { Boxes, Server } from "lucide-react";
import { ScreenTitle } from "@pi-studio-ui/components/primitives/ScreenTitle.js";
import { useSavedServersStore } from "@pi-studio-ui/stores/saved-servers-store.js";
import { ProvidersDetail } from "@pi-studio-ui/features/settings/ProvidersDetail.js";
import { ServerDetail } from "@pi-studio-ui/features/settings/ServerDetail.js";
import { ServerFormDialog } from "@pi-studio-ui/features/settings/ServerFormDialog.js";
import {
  SettingsSidebar,
  type SettingsSelection,
} from "@pi-studio-ui/features/settings/SettingsSidebar.js";
import styles from "./SettingsPage.module.css";

export function SettingsPage() {
  const servers = useSavedServersStore((s) => s.servers);
  const [selection, setSelection] = useState<SettingsSelection | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  // Derived selection — never stale: a deleted server id falls back to the first server,
  // then to Providers when no servers exist.
  const effective: SettingsSelection =
    selection?.kind === "server" && servers.some((s) => s.id === selection.id)
      ? selection
      : selection?.kind === "providers"
        ? selection
        : servers[0]
          ? { kind: "server", id: servers[0].id }
          : { kind: "providers" };

  const selectedServer =
    effective.kind === "server" ? servers.find((s) => s.id === effective.id) : undefined;

  return (
    <div className={styles.shell}>
      <SettingsSidebar
        selection={effective}
        onSelect={setSelection}
        onAddServer={() => setAddOpen(true)}
      />

      <div className={styles.pane}>
        <header className={styles.header}>
          {effective.kind === "providers" ? (
            <Boxes size={16} aria-hidden className={styles.headerIcon} />
          ) : (
            <Server size={16} aria-hidden className={styles.headerIcon} />
          )}
          <ScreenTitle>
            {effective.kind === "providers" ? "Providers" : (selectedServer?.name ?? "Server")}
          </ScreenTitle>
        </header>

        <div className={styles.body}>
          <div className={styles.column}>
            {effective.kind === "providers" ? (
              <ProvidersDetail />
            ) : selectedServer ? (
              <ServerDetail server={selectedServer} />
            ) : null}
          </div>
        </div>
      </div>

      <ServerFormDialog open={addOpen} onOpenChange={setAddOpen} />
    </div>
  );
}
