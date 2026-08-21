/**
 * ConnectionBar — the app's top row: brand + version, the connection status pill, the url/password
 * fields, the single primary connect/disconnect action, and the two panel toggles (design spec
 * § 08; replaces the POC-era `Toolbar`/`ConnectionStatus` pair, POC_TO_APP_PLAN_UI.md §4.1).
 *
 * All state shape lives in `connection-presentation.ts` — this component only binds it to the
 * stores and the DOM. What changes per state: a live connection collapses to one pill plus a
 * trailing action; disconnected/connecting/error show the editable fields, with the pill and action
 * communicating which of those three sub-states is active.
 *
 * The url field ALSO accepts a full pairing link (`pi-studio daemon pair`'s QR/link,
 * architecture/relay-e2ee.md § Pairing) pasted verbatim — `connect()` detects it via
 * `parsePairingUrl` and routes through the relay transport automatically; the password field is
 * ignored in that case (the pairing link's key is itself the credential). The 220px field can't
 * show that as placeholder text, so it lives in the field's `title` tooltip.
 */

import { lazy, Suspense, useEffect, useRef, useState } from "react";
import {
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Settings,
} from "lucide-react";
import { clsx } from "clsx";
import { Button } from "@pi-studio-ui/components/primitives/Button.js";
import { Icon } from "@pi-studio-ui/components/primitives/Icon.js";
import { Spinner } from "@pi-studio-ui/components/primitives/Spinner.js";
import { StatusDot } from "@pi-studio-ui/components/primitives/StatusDot.js";
import { TextInput } from "@pi-studio-ui/components/primitives/TextInput.js";
import { useConnectionStore } from "@pi-studio-ui/lib/connection/connection-store.js";
import { useUiStore } from "@pi-studio-ui/stores/ui-store.js";
import { connectionBarView, connectionDot, isDialableTarget } from "./connection-presentation.js";
import styles from "./ConnectionBar.module.css";

// Lazy: the settings shell + Model Providers panel must not ship in the initial bundle chunk.
// Only imported once the gear is actually clicked (see `settingsEverOpened` below).
const SettingsDialog = lazy(() =>
  import("../settings/SettingsDialog.js").then((m) => ({ default: m.SettingsDialog })),
);

/**
 * The bar's control height per § 08. `Button`'s smallest size floors at 28px
 * (`ui/button.ts` `BUTTON_MIN_HEIGHT.xs`) and applies it inline, so it is overridden through
 * `style` at the call sites below — `Button` spreads `style` last, making that supported.
 */
const CONTROL_HEIGHT = 26;

/**
 * § 08 puts the action on the same `2xs` rung as the pill and the fields. `Button` inlines its
 * size's font (`ui/button.ts` `BUTTON_FONT_SIZE.xs` = `xs`, one rung larger), which made the
 * action's label read visibly bigger than everything beside it — so it is overridden too.
 */
const CONTROL_FONT_SIZE = "var(--pi-font-size-2xs)";

/** § 08: the connecting spinner is 9px, a touch smaller than the 8px dot's optical weight. */
const SPINNER_SIZE = 9;

const URL_HINT = "host:port, ws://…/http://…, or a pasted pairing link";

export function ConnectionBar() {
  const status = useConnectionStore((s) => s.status);
  const error = useConnectionStore((s) => s.error);
  const connect = useConnectionStore((s) => s.connect);
  const disconnect = useConnectionStore((s) => s.disconnect);
  const serverInfo = useConnectionStore((s) => s.serverInfo);

  const host = useUiStore((s) => s.host);
  const setHost = useUiStore((s) => s.setHost);
  const password = useUiStore((s) => s.password);
  const setPassword = useUiStore((s) => s.setPassword);
  const leftSidebarCollapsed = useUiStore((s) => s.leftSidebarCollapsed);
  const toggleLeftSidebar = useUiStore((s) => s.toggleLeftSidebar);
  const rightSidebarCollapsed = useUiStore((s) => s.rightSidebarCollapsed);
  const toggleRightSidebar = useUiStore((s) => s.toggleRightSidebar);
  const settingsOpen = useUiStore((s) => s.settingsOpen);
  const openSettings = useUiStore((s) => s.openSettings);
  const closeSettings = useUiStore((s) => s.closeSettings);

  // Mirrors `PiStudioClient#hasProviderAuthCapability()`, read reactively off the tracked
  // `serverInfo` field rather than the imperative method (the store's `client` reference stays
  // stable across a reconnect while its internal feature map mutates in place).
  const providerAuthCapable = Boolean(serverInfo?.features?.["providerAuth"]);
  // Defers the settings chunk's `import()` until settings has ever been opened, while still
  // letting `Dialog`'s close animation play out afterward (an `open && <SettingsDialog/>` guard
  // would unmount it mid-close instead). Watches `settingsOpen` rather than latching only inside
  // this button's own click handler, so `openSettings()` called from elsewhere (the chat empty
  // state's onboarding nudge, task-006) also mounts the dialog on its first use.
  const [settingsEverOpened, setSettingsEverOpened] = useState(settingsOpen);
  useEffect(() => {
    if (settingsOpen) setSettingsEverOpened(true);
  }, [settingsOpen]);

  const view = connectionBarView({ status, error, url: host });
  const dot = connectionDot(view.kind);

  // Esc reverts a field to its last committed value — the pair last handed to `connect()`, seeded
  // with what was restored into the store so Esc before any attempt still has something to go to.
  const committed = useRef({ host, password });
  // Invalid-scheme feedback is blur-gated (§ 08) so it can't fire on every keystroke mid-typing.
  const [urlBlurred, setUrlBlurred] = useState(false);
  const urlInvalid = urlBlurred && host.trim() !== "" && !isDialableTarget(host);

  function submit() {
    if (view.action.disabled) return;
    committed.current = { host, password };
    void connect({ url: host, password: password || undefined });
  }

  function onAction() {
    if (view.kind === "connected" || view.kind === "closing") {
      disconnect();
      return;
    }
    submit();
  }

  function onFieldKeyDown(event: React.KeyboardEvent<HTMLInputElement>, field: "url" | "password") {
    if (event.key === "Enter") {
      event.preventDefault();
      submit();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      if (field === "url") {
        setHost(committed.current.host);
        setUrlBlurred(false);
      } else {
        setPassword(committed.current.password);
      }
      event.currentTarget.blur();
    }
  }

  return (
    <div className={styles.bar}>
      <span className={styles.title}>
        <span className={styles.brand}>{__BRAND_TITLE__}</span>
        <span className={styles.version}>v{__APP_VERSION__}</span>
      </span>

      <span
        className={clsx(styles.statusPill, view.kind === "error" && styles.statusPillError)}
        title={view.title}
      >
        {dot ? (
          <StatusDot {...dot} className={styles.statusDot} />
        ) : (
          <Spinner
            size={SPINNER_SIZE}
            color="var(--pi-color-statusWarning)"
            className={styles.statusSpinner}
            aria-label="Connecting"
          />
        )}
        <span className={styles.statusText}>
          {view.hostLabel && <span className={styles.statusHost}>{view.hostLabel}</span>}
          {view.hostLabel && (
            <span className={styles.statusSep} aria-hidden>
              ·
            </span>
          )}
          <span className={styles.statusLabel} aria-live="polite">
            {view.statusLabel}
          </span>
        </span>
      </span>

      {view.showFields && (
        <>
          <TextInput
            className={clsx(styles.field, styles.fieldUrl, urlInvalid && styles.fieldInvalid)}
            value={host}
            onChange={(e) => setHost(e.target.value)}
            onFocus={() => setUrlBlurred(false)}
            onBlur={() => setUrlBlurred(true)}
            onKeyDown={(e) => onFieldKeyDown(e, "url")}
            readOnly={view.fieldsFrozen}
            placeholder="ws://127.0.0.1:6767"
            title={urlInvalid ? `Not a dialable daemon address — ${URL_HINT}` : URL_HINT}
            aria-label="Daemon address"
            aria-invalid={urlInvalid || undefined}
            spellCheck={false}
            autoComplete="off"
          />
          <TextInput
            className={clsx(styles.field, styles.fieldPassword)}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => onFieldKeyDown(e, "password")}
            readOnly={view.fieldsFrozen}
            placeholder="password"
            title="Daemon password — ignored when the address is a pairing link"
            aria-label="Daemon password"
            autoComplete="off"
          />
        </>
      )}

      <Button
        className={styles.action}
        size="xs"
        variant={view.action.variant}
        disabled={view.action.disabled}
        style={{ minHeight: CONTROL_HEIGHT, fontSize: CONTROL_FONT_SIZE }}
        onClick={onAction}
      >
        {view.action.label}
      </Button>

      <div className={styles.panelToggles}>
        <Button
          className={styles.panelToggle}
          size="xs"
          variant="ghost"
          iconOnly
          style={{ minHeight: CONTROL_HEIGHT, width: CONTROL_HEIGHT }}
          aria-label="Toggle left panel"
          title={leftSidebarCollapsed ? "Show sessions sidebar" : "Hide sessions sidebar"}
          onClick={() => toggleLeftSidebar()}
        >
          <Icon icon={leftSidebarCollapsed ? PanelLeftOpen : PanelLeftClose} size="sm" />
        </Button>
        <Button
          className={styles.panelToggle}
          size="xs"
          variant="ghost"
          iconOnly
          style={{ minHeight: CONTROL_HEIGHT, width: CONTROL_HEIGHT }}
          aria-label="Toggle right panel"
          title={
            rightSidebarCollapsed ? "Show files/changes sidebar" : "Hide files/changes sidebar"
          }
          onClick={() => toggleRightSidebar()}
        >
          <Icon icon={rightSidebarCollapsed ? PanelRightOpen : PanelRightClose} size="sm" />
        </Button>
        {providerAuthCapable && (
          <Button
            className={styles.panelToggle}
            size="xs"
            variant="ghost"
            iconOnly
            style={{ minHeight: CONTROL_HEIGHT, width: CONTROL_HEIGHT }}
            aria-label="Settings"
            title="Settings"
            onClick={() => openSettings()}
          >
            <Icon icon={Settings} size="sm" />
          </Button>
        )}
      </div>

      {settingsEverOpened && (
        <Suspense fallback={null}>
          <SettingsDialog
            open={settingsOpen}
            onOpenChange={(next) => (next ? openSettings() : closeSettings())}
          />
        </Suspense>
      )}
    </div>
  );
}
