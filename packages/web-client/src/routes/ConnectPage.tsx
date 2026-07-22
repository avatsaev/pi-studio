/**
 * ConnectPage — full-screen connection surface: manual host/password entry (binding the
 * same ui-store fields as the workspace Toolbar) plus one-click connect from the saved
 * servers managed in Settings. Successful connects navigate to the workspace; failures
 * stay here with `connection-store.error` visible.
 */

import { Link } from "react-router";
import { ArrowLeft, Server } from "lucide-react";
import { Button } from "@pi-studio-ui/components/primitives/Button.js";
import { ScreenTitle } from "@pi-studio-ui/components/primitives/ScreenTitle.js";
import { Surface } from "@pi-studio-ui/components/primitives/Surface.js";
import { TextInput } from "@pi-studio-ui/components/primitives/TextInput.js";
import { ConnectionStatus } from "@pi-studio-ui/features/connection/ConnectionStatus.js";
import { useConnectionStore } from "@pi-studio-ui/lib/connection/connection-store.js";
import { useConnectToServer } from "@pi-studio-ui/lib/connection/connect-to-server.js";
import { useSavedServersStore } from "@pi-studio-ui/stores/saved-servers-store.js";
import { useUiStore } from "@pi-studio-ui/stores/ui-store.js";
import styles from "./ConnectPage.module.css";

export function ConnectPage() {
  const status = useConnectionStore((s) => s.status);
  const error = useConnectionStore((s) => s.error);
  const disconnect = useConnectionStore((s) => s.disconnect);

  const host = useUiStore((s) => s.host);
  const setHost = useUiStore((s) => s.setHost);
  const password = useUiStore((s) => s.password);
  const setPassword = useUiStore((s) => s.setPassword);

  const servers = useSavedServersStore((s) => s.servers);
  const connectToServer = useConnectToServer();

  const busy = status === "connecting" || status === "closing";

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
        <ScreenTitle>Connect to a daemon</ScreenTitle>

        <Surface className={styles.card}>
          <div className={styles.formRow}>
            <TextInput
              className={styles.hostInput}
              value={host}
              onChange={(e) => setHost(e.target.value)}
              placeholder="host:port, ws://…/http://…, or a pairing link"
              disabled={busy}
            />
            <TextInput
              className={styles.passwordInput}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="password"
              disabled={busy}
            />
            {status === "open" || busy ? (
              <Button variant="default" onClick={() => disconnect()}>
                Disconnect
              </Button>
            ) : (
              <Button
                variant="default"
                onClick={() => void connectToServer({ url: host, password: password || undefined })}
              >
                Connect
              </Button>
            )}
          </div>
          {error && <p className={styles.error}>{error}</p>}
        </Surface>

        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>Saved servers</h2>
            <Link to="/settings" className={styles.manageLink}>
              Manage in Settings
            </Link>
          </div>
          {servers.length === 0 ? (
            <p className={styles.empty}>
              No saved servers yet — add them in <Link to="/settings">Settings</Link> to connect
              with one click.
            </p>
          ) : (
            <ul className={styles.serverList}>
              {servers.map((server) => (
                <li key={server.id}>
                  <Surface className={styles.serverRow}>
                    <Server size={16} aria-hidden className={styles.serverIcon} />
                    <span className={styles.serverName}>{server.name}</span>
                    <span className={styles.serverUrl}>{server.url}</span>
                    <Button
                      size="sm"
                      variant="default"
                      disabled={busy}
                      onClick={() =>
                        void connectToServer({ url: server.url, password: server.password })
                      }
                    >
                      Connect
                    </Button>
                  </Surface>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
