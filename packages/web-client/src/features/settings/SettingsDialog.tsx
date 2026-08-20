/**
 * SettingsDialog — the app's settings shell (sprint-065/task-003): a large `Dialog`-primitive
 * modal with a category sidebar and a content pane. There is no settings screen or router in
 * web-client today (`routes/WorkspacePage.tsx` is a single shell) — this modal *is* the settings
 * IA rather than a one-off provider modal that would need migrating later: future categories
 * (Appearance is the obvious next) add a registry entry here, not a new surface, and
 * `app-navigation-screens.md`'s `/settings/hosts/[serverId]/providers` route renders these same
 * category panels when that scope lands. Building any category beyond Model Providers is other
 * scopes' work — see `SETTINGS_CATEGORIES` below.
 *
 * The sidebar renders even with one entry: it is the IA, not decoration.
 */

import { lazy, Suspense, useEffect, useState, type ComponentType } from "react";
import { KeyRound, type LucideIcon } from "lucide-react";
import { clsx } from "clsx";
import {
  Dialog,
  type DialogProps,
  EmptyState,
  Icon,
  Spinner,
} from "@pi-studio-ui/components/primitives/index.js";
import { useConnectionStore } from "@pi-studio-ui/lib/connection/connection-store.js";
import { LoginDialog } from "../provider-auth/LoginDialog.js";
import { useProviderAuthUiStore } from "../provider-auth/provider-auth-store.js";
import styles from "./SettingsDialog.module.css";

/** Server capabilities a settings category may gate its availability on. Grows as new
 *  capability-gated categories are added; a capability-independent category (e.g. Appearance)
 *  simply ignores this and always returns true. */
export interface SettingsCategoryCapabilities {
  providerAuth: boolean;
}

export interface SettingsCategory {
  id: string;
  label: string;
  icon: LucideIcon;
  component: ComponentType;
  available: (caps: SettingsCategoryCapabilities) => boolean;
}

const ModelProvidersPanel = lazy(() =>
  import("../provider-auth/ModelProvidersPanel.js").then((m) => ({
    default: m.ModelProvidersPanel,
  })),
);

export const SETTINGS_CATEGORIES: SettingsCategory[] = [
  {
    id: "providers",
    label: "Model Providers",
    icon: KeyRound,
    component: ModelProvidersPanel,
    available: (caps) => caps.providerAuth,
  },
];

export interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  const serverInfo = useConnectionStore((s) => s.serverInfo);
  const pendingLogin = useProviderAuthUiStore((s) => s.pendingLogin);
  const cancelLogin = useProviderAuthUiStore((s) => s.cancelLogin);

  // Mirrors `PiStudioClient#hasProviderAuthCapability()` reactively — the store's `client`
  // reference stays stable across a reconnect while its internal `_features` mutates in place, so
  // reading `serverInfo` (a tracked Zustand field) is what actually re-renders this component.
  const caps: SettingsCategoryCapabilities = {
    providerAuth: Boolean(serverInfo?.features?.["providerAuth"]),
  };
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
   * Keeps a stacked login dialog's interactions from dismissing *this* dialog. The two contents
   * are DOM siblings (each Radix dialog portals to `body`), so a pointerdown inside the login
   * dialog reads as an outside-interaction here, and closing the login dialog closed Settings
   * along with it.
   *
   * Two rules, because Radix does not always dispatch while the upper layer still exists: it
   * defers a non-mouse `pointerdown` to the following `click`, by which point the login dialog's
   * own Cancel handler has already cleared `pendingLogin` and unmounted that layer — so the
   * "is a login pending" test alone reports false and lets the dismissal through.
   */
  function suppressStackedDismiss(
    event: Parameters<NonNullable<DialogProps["onInteractOutside"]>>[0],
  ) {
    // 1. The login dialog is still up: nothing happening inside it belongs to this dialog.
    if (pendingLogin) {
      event.preventDefault();
      return;
    }
    // 2. The interaction's target has since left the document — it belonged to a layer stacked
    //    above us that closed *as a result of this very interaction*, so it is not an outside
    //    click on this dialog either.
    const target = event.detail.originalEvent.target;
    if (target instanceof Node && !target.isConnected) event.preventDefault();
  }

  /** Esc is dispatched synchronously to the topmost layer, so the pending-login test is enough. */
  function suppressStackedEscape(event: KeyboardEvent) {
    if (pendingLogin) event.preventDefault();
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
