/**
 * Read-mostly views over the private stores for a custom shell
 * (`swe/architecture/workbench-package.md` § Root entry: hooks). The stores themselves stay private.
 */

import { type ConnectionState } from "@av-pi-studio/client";
import { type ServerInfoPayload } from "@av-pi-studio/protocol";
import { useShallow } from "zustand/react/shallow";
import { type ConnectOptions, useConnectionStore } from "../lib/connection/connection-store.js";
import { useUiStore } from "../stores/ui-store.js";
import { useRequireWorkbench } from "./context.js";

export interface WorkbenchConnection {
  status: ConnectionState;
  serverInfo: ServerInfoPayload | null;
  error: string | null;
  connect(options: ConnectOptions): Promise<void>;
  disconnect(): void;
}

export function useConnection(): WorkbenchConnection {
  useRequireWorkbench("useConnection");
  return useConnectionStore(
    useShallow((s) => ({
      status: s.status,
      serverInfo: s.serverInfo,
      error: s.error,
      connect: s.connect,
      disconnect: s.disconnect,
    })),
  );
}

export interface SidebarLayout {
  collapsed: boolean;
  width: number;
  toggle(): void;
  /** Grow (positive) or shrink by `delta` pixels, clamped. */
  resize(delta: number): void;
}

export function useShellLayout(): { left: SidebarLayout; right: SidebarLayout } {
  useRequireWorkbench("useShellLayout");
  const s = useUiStore(
    useShallow((ui) => ({
      leftCollapsed: ui.leftSidebarCollapsed,
      leftWidth: ui.leftSidebarWidth,
      toggleLeft: ui.toggleLeftSidebar,
      resizeLeft: ui.resizeLeftSidebar,
      rightCollapsed: ui.rightSidebarCollapsed,
      rightWidth: ui.rightSidebarWidth,
      toggleRight: ui.toggleRightSidebar,
      resizeRight: ui.resizeRightSidebar,
    })),
  );
  return {
    left: {
      collapsed: s.leftCollapsed,
      width: s.leftWidth,
      toggle: s.toggleLeft,
      resize: s.resizeLeft,
    },
    right: {
      collapsed: s.rightCollapsed,
      width: s.rightWidth,
      toggle: s.toggleRight,
      resize: s.resizeRight,
    },
  };
}

export function useSettingsDialog(): {
  open: boolean;
  openSettings(): void;
  closeSettings(): void;
} {
  useRequireWorkbench("useSettingsDialog");
  return useUiStore(
    useShallow((s) => ({
      open: s.settingsOpen,
      openSettings: s.openSettings,
      closeSettings: s.closeSettings,
    })),
  );
}
