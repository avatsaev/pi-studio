/**
 * DaemonSwitcher — the connection bar's status pill when the host has a daemon registry: a button
 * showing the current entry's name and connection status that opens a list of entries (pick one to
 * switch) ending in "Manage daemons…". Built on the design system's `DropdownMenu` chrome, so the
 * trigger and the list are keyboard operable (Enter/Space/ArrowDown opens, arrows move, Esc closes).
 *
 * What is shown and what a choice does is decided in `daemon-switcher-presentation.ts`.
 */

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Check, ChevronDown } from "lucide-react";
import { clsx } from "clsx";
import type { ConnectionState } from "@av-pi-studio/client";
import {
  MenuContent,
  MenuItem,
  MenuSeparator,
  Spinner,
  StatusDot,
  useToastStore,
} from "@av-pi-studio/ui-library";
import { getHost } from "../../host/install.js";
import { LINK_INVALID_LABEL } from "../daemons/daemons-screen-view.js";
import { useDaemonsStore } from "../daemons/daemons-store.js";
import { connectionDot } from "./connection-presentation.js";
import {
  MANAGE_DAEMONS_LABEL,
  type DaemonSwitcherView,
  daemonChoice,
  switchFailureMessage,
} from "./daemon-switcher-presentation.js";
import styles from "./ConnectionBar.module.css";

/** § 08: the connecting spinner is 9px, a touch smaller than the 8px dot's optical weight. */
const SPINNER_SIZE = 9;

function choose(currentId: string | null, status: ConnectionState, id: string): void {
  const choice = daemonChoice({ currentId, id, status });
  switch (choice.kind) {
    case "nothing":
      return;
    case "reconnect":
      void useDaemonsStore.getState().connectCurrent();
      return;
    case "switch":
      // On success the host reloads the page, so only a rejection comes back here.
      getHost()
        .daemons?.switchTo(choice.id)
        .catch((error: unknown) => useToastStore.getState().error(switchFailureMessage(error)));
      return;
  }
}

export function DaemonSwitcher({
  view,
  currentId,
  status,
}: {
  view: DaemonSwitcherView;
  currentId: string | null;
  status: ConnectionState;
}) {
  const dot = connectionDot(view.kind);
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className={clsx(
            styles.statusPill,
            styles.switcher,
            view.kind === "error" && styles.statusPillError,
          )}
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
            <span className={styles.switcherName}>{view.name}</span>
            {view.statusLabel !== null && (
              <span className={styles.statusSep} aria-hidden>
                ·
              </span>
            )}
            {view.statusLabel !== null && (
              <span className={styles.statusLabel} aria-live="polite">
                {view.statusLabel}
              </span>
            )}
          </span>
          <ChevronDown size={12} className={styles.switcherChevron} aria-hidden />
        </button>
      </DropdownMenu.Trigger>
      <MenuContent minWidth={220} sideOffset={4} className={styles.switcherMenu}>
        {view.items.map((item) => (
          <MenuItem
            key={item.id}
            title={item.name}
            data-current={item.current || undefined}
            onSelect={() => choose(currentId, status, item.id)}
          >
            <span className={styles.switcherCheck} aria-hidden>
              {item.current && <Check size={14} />}
            </span>
            <span className={styles.switcherItemName}>{item.name}</span>
            <span className={styles.switcherItemKind}>{item.kindLabel}</span>
            {item.linkInvalid && (
              <span className={styles.switcherItemInvalid}>{LINK_INVALID_LABEL}</span>
            )}
          </MenuItem>
        ))}
        {view.items.length > 0 && <MenuSeparator />}
        <MenuItem onSelect={() => useDaemonsStore.getState().openScreen()}>
          <span className={styles.switcherCheck} aria-hidden />
          <span className={styles.switcherItemName}>{MANAGE_DAEMONS_LABEL}</span>
        </MenuItem>
      </MenuContent>
    </DropdownMenu.Root>
  );
}
