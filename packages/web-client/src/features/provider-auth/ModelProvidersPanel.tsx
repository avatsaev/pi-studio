/**
 * ModelProvidersPanel — the Settings dialog's Model Providers category (sprint-065/task-003).
 * Lists `listProviderAuth()` results with an auth-state badge and per-row `Log in`/`Re-login`/
 * `Log out` actions. The actual login flow (the SDK call, the prompt/QR/status rendering) is
 * task-004/005's job — this panel's `Log in` action only hands the chosen provider + auth method
 * off through `provider-auth-store.ts`'s `requestLogin`.
 *
 * All server access goes through the task-001 SDK methods (`listProviderAuth`/`logoutProvider`) —
 * never `client.connection.request` for this family.
 */

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { ProviderAuthInfo } from "@av-pi-studio/protocol";
import {
  Button,
  EmptyState,
  Spinner,
  StatusBadge,
} from "@pi-studio-ui/components/primitives/index.js";
import { useProviderAuthList } from "@pi-studio-ui/hooks/use-provider-auth-list.js";
import { useConnectionStore } from "@pi-studio-ui/lib/connection/connection-store.js";
import { rpcKeys } from "@pi-studio-ui/lib/connection/rpc-keys.js";
import { providerAuthBadge, providerAuthLoginChoices } from "./provider-auth-presentation.js";
import { useProviderAuthUiStore } from "./provider-auth-store.js";
import styles from "./ModelProvidersPanel.module.css";

export function ModelProvidersPanel() {
  const client = useConnectionStore((s) => s.client);
  const queryClient = useQueryClient();
  const pendingLogin = useProviderAuthUiStore((s) => s.pendingLogin);
  const requestLogin = useProviderAuthUiStore((s) => s.requestLogin);

  const [loggingOutId, setLoggingOutId] = useState<string | null>(null);
  const [rowNotes, setRowNotes] = useState<Record<string, string>>({});

  const { data: providers, isLoading, isError, error } = useProviderAuthList();

  async function handleLogout(provider: ProviderAuthInfo) {
    if (!client) return;
    if (
      !window.confirm(
        `Log out of ${provider.name}? Running agents keep working until their current credential use fails.`,
      )
    ) {
      return;
    }
    setRowNotes((notes) => ({ ...notes, [provider.id]: "" }));
    setLoggingOutId(provider.id);
    try {
      const result = await client.logoutProvider(provider.id);
      setRowNotes((notes) => ({
        ...notes,
        [provider.id]: result.stillConfigured
          ? "Removed the stored credential — still configured via an environment variable."
          : "",
      }));
      await queryClient.invalidateQueries({ queryKey: rpcKeys.providerAuthList() });
    } finally {
      setLoggingOutId(null);
    }
  }

  if (isLoading) {
    return (
      <EmptyState>
        <Spinner size="sm" /> Loading providers…
      </EmptyState>
    );
  }

  if (isError) {
    return (
      <EmptyState className={styles.errorState}>
        {error instanceof Error ? error.message : "Failed to load providers."}
      </EmptyState>
    );
  }

  if (!providers || providers.length === 0) {
    return <EmptyState>No providers available.</EmptyState>;
  }

  return (
    <div className={styles.list}>
      {providers.map((provider) => {
        const badge = providerAuthBadge(provider);
        const choices = providerAuthLoginChoices(provider);
        const isPending = pendingLogin?.provider === provider.id;
        const rowDisabled = pendingLogin !== null && !isPending;
        const note = rowNotes[provider.id];

        return (
          <div key={provider.id} className={styles.row}>
            <div className={styles.rowMain}>
              <span className={styles.name}>{provider.name}</span>
              {provider.oauthIsSubscription && (
                <StatusBadge label="Subscription" variant="muted" className={styles.tag} />
              )}
              <StatusBadge label={badge.label} variant={badge.variant} className={styles.tag} />
            </div>
            <div className={styles.rowActions}>
              {isPending ? (
                <span className={styles.pendingNote}>Logging in…</span>
              ) : (
                <>
                  {choices.map((choice) => (
                    <Button
                      key={choice.authType}
                      size="xs"
                      variant="secondary"
                      disabled={rowDisabled}
                      onClick={() => requestLogin(provider.id, provider.name, choice.authType)}
                    >
                      {choice.label}
                    </Button>
                  ))}
                  {provider.configured !== false && (
                    <Button
                      size="xs"
                      variant="ghost"
                      disabled={rowDisabled || loggingOutId === provider.id}
                      loading={loggingOutId === provider.id}
                      onClick={() => void handleLogout(provider)}
                    >
                      Log out
                    </Button>
                  )}
                </>
              )}
            </div>
            {note && <div className={styles.note}>{note}</div>}
          </div>
        );
      })}
    </div>
  );
}
