/**
 * Toolbar — brand, connection status, host/password inputs, connect/disconnect (POC toolbar,
 * POC_TO_APP_PLAN_UI.md §4.1). Both sidebar-visibility toggles sit together at the far right
 * (`.sidebarToggles`, `margin-left: auto`). Provider is always "pi" (see Composer.tsx) — this
 * project has no other provider to select. "Open Workspace" lives in the sidebar header
 * (SessionList.tsx), not here.
 */

import { PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen } from "lucide-react";
import { Button } from "@pi-studio-ui/components/primitives/Button.js";
import { TextInput } from "@pi-studio-ui/components/primitives/TextInput.js";
import { useConnectionStore } from "@pi-studio-ui/lib/connection/connection-store.js";
import { useUiStore } from "@pi-studio-ui/stores/ui-store.js";
import { ConnectionStatus } from "./ConnectionStatus.js";
import styles from "./Toolbar.module.css";

export function Toolbar() {
  const status = useConnectionStore((s) => s.status);
  const connect = useConnectionStore((s) => s.connect);
  const disconnect = useConnectionStore((s) => s.disconnect);

  const host = useUiStore((s) => s.host);
  const setHost = useUiStore((s) => s.setHost);
  const password = useUiStore((s) => s.password);
  const setPassword = useUiStore((s) => s.setPassword);
  const leftSidebarCollapsed = useUiStore((s) => s.leftSidebarCollapsed);
  const toggleLeftSidebar = useUiStore((s) => s.toggleLeftSidebar);
  const rightSidebarCollapsed = useUiStore((s) => s.rightSidebarCollapsed);
  const toggleRightSidebar = useUiStore((s) => s.toggleRightSidebar);

  const connected = status === "open" || status === "connecting";

  return (
    <div className={styles.toolbar}>
      <span className={styles.brand}>Pi-Studio</span>
      <ConnectionStatus />
      <div className={styles.sep} />
      <TextInput
        className={styles.host}
        value={host}
        onChange={(e) => setHost(e.target.value)}
        placeholder="ws://host:port"
        disabled={connected}
      />
      <TextInput
        className={styles.password}
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="password"
        disabled={connected}
      />
      {status === "open" || status === "connecting" || status === "closing" ? (
        <Button size="sm" onClick={() => disconnect()}>
          Disconnect
        </Button>
      ) : (
        <Button
          size="sm"
          variant="default"
          onClick={() => void connect({ url: host, password: password || undefined })}
        >
          Connect
        </Button>
      )}
      <div className={styles.sidebarToggles}>
        <Button
          size="sm"
          variant="ghost"
          iconOnly
          title={leftSidebarCollapsed ? "Show sessions sidebar" : "Hide sessions sidebar"}
          onClick={() => toggleLeftSidebar()}
        >
          {leftSidebarCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          iconOnly
          title={rightSidebarCollapsed ? "Show files/changes sidebar" : "Hide files/changes sidebar"}
          onClick={() => toggleRightSidebar()}
        >
          {rightSidebarCollapsed ? <PanelRightOpen size={16} /> : <PanelRightClose size={16} />}
        </Button>
      </div>
    </div>
  );
}
