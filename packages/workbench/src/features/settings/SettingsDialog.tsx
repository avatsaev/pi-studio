/**
 * SettingsDialog — the app's settings shell (sprint-065/task-003): a large `Dialog`-primitive
 * modal with a category sidebar and a content pane. There is no settings screen or router in
 * web-client today (`routes/WorkspacePage.tsx` is a single shell) — this modal *is* the settings
 * IA rather than a one-off provider modal that would need migrating later: new categories
 * add a registry entry in `settings-categories.ts`, not a new surface, and `app-navigation-screens.md`'s `/settings/hosts/[serverId]/providers` route renders
 * these same category panels when that scope lands.
 *
 * The category registry itself (`SETTINGS_CATEGORIES`, `buildSettingsCategoryCapabilities`) lives
 * in `settings-categories.ts`, not here — `ConnectionBar.tsx` needs it eagerly (to gate the
 * settings gear) without pulling this file's own eager imports (`Dialog`, `LoginDialog`,
 * `provider-auth-store`) into the main bundle ahead of the gear ever being clicked.
 *
 * The sidebar renders even with one entry: it is the IA, not decoration.
 */

import { Suspense, useEffect, useState } from "react";
import { clsx } from "clsx";
import { Dialog, type DialogProps, EmptyState, Icon, Spinner } from "@av-pi-studio/ui-library";
import { getHost } from "../../host/install.js";
import { useConnectionStore } from "../../lib/connection/connection-store.js";
import { useUiStore } from "../../stores/ui-store.js";
import { LoginDialog } from "../provider-auth/LoginDialog.js";
import { useProviderAuthUiStore } from "../provider-auth/provider-auth-store.js";
import { buildSettingsCategoryCapabilities, SETTINGS_CATEGORIES } from "./settings-categories.js";
import styles from "./SettingsDialog.module.css";

export interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  const serverInfo = useConnectionStore((s) => s.serverInfo);
  const pendingLogin = useProviderAuthUiStore((s) => s.pendingLogin);
  const cancelLogin = useProviderAuthUiStore((s) => s.cancelLogin);
  // The update dialog (opened from the Daemon category, mounted by the connection bar) stacks
  // over this one exactly as the login dialog does.
  const updateDialogOpen = useUiStore((s) => s.daemonUpdateDialogOpen);

  // Reactive over `serverInfo` (a tracked Zustand field) rather than the imperative
  // `PiStudioClient#hasProviderAuthCapability()` — the store's `client` reference stays stable
  // across a reconnect while its internal `_features` mutates in place.
  const caps = buildSettingsCategoryCapabilities(serverInfo?.features, {
    usageData: getHost().usageData !== undefined,
  });
  const categories = SETTINGS_CATEGORIES.filter((c) => c.available(caps));

  const [selectedId, setSelectedId] = useState<string | undefined>(categories[0]?.id);
  useEffect(() => {
    if (!categories.some((c) => c.id === selectedId)) {
      setSelectedId(categories[0]?.id);
    }
    // Re-run only when the available category set changes, not on every selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categories.map((c) => c.id).join(",")]);

  const selected = categories.find((c) => c.id === selectedId) ?? categories[0];
  const Content = selected?.component;

  function handleOpenChange(next: boolean) {
    if (!next && pendingLogin) cancelLogin();
    onOpenChange(next);
  }

  /**
   * Keeps a stacked dialog's interactions (the login dialog, the daemon update dialog) from
   * dismissing *this* dialog. The contents are DOM siblings (each Radix dialog portals to
   * `body`), so a pointerdown inside the upper dialog reads as an outside-interaction here, and
   * closing the upper dialog closed Settings along with it.
   *
   * Two rules, because Radix does not always dispatch while the upper layer still exists: it
   * defers a non-mouse `pointerdown` to the following `click`, by which point the upper dialog's
   * own Cancel handler has already cleared its state and unmounted that layer — so the
   * "is a stacked dialog open" test alone reports false and lets the dismissal through.
   */
  function suppressStackedDismiss(
    event: Parameters<NonNullable<DialogProps["onInteractOutside"]>>[0],
  ) {
    // 1. A stacked dialog is still up: nothing happening inside it belongs to this dialog.
    if (pendingLogin || updateDialogOpen) {
      event.preventDefault();
      return;
    }
    // 2. The interaction's target has since left the document — it belonged to a layer stacked
    //    above us that closed *as a result of this very interaction*, so it is not an outside
    //    click on this dialog either.
    const target = event.detail.originalEvent.target;
    if (target instanceof Node && !target.isConnected) event.preventDefault();
  }

  /** Esc is dispatched synchronously to the topmost layer, so the open-dialog test is enough. */
  function suppressStackedEscape(event: KeyboardEvent) {
    if (pendingLogin || updateDialogOpen) event.preventDefault();
  }

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={handleOpenChange}
        title="Settings"
        width={900}
        onInteractOutside={suppressStackedDismiss}
        onEscapeKeyDown={suppressStackedEscape}
      >
        <div className={styles.shell}>
          <nav className={styles.sidebar}>
            {categories.map((category) => (
              <button
                key={category.id}
                type="button"
                className={clsx(
                  styles.category,
                  category.id === selected?.id && styles.categoryActive,
                )}
                onClick={() => setSelectedId(category.id)}
              >
                <Icon icon={category.icon} size="sm" />
                {category.label}
              </button>
            ))}
          </nav>
          <div className={styles.content}>
            {Content ? (
              <Suspense
                fallback={
                  <EmptyState>
                    <Spinner size="sm" /> Loading…
                  </EmptyState>
                }
              >
                <Content />
              </Suspense>
            ) : (
              <EmptyState>No settings categories available.</EmptyState>
            )}
          </div>
        </div>
      </Dialog>
      <LoginDialog />
    </>
  );
}
