/**
 * NewAgentPage — functional "create agent" form for `/new`.
 *
 * Provider + profile (mode) selection is populated from live daemon data via
 * `useProviders()` and persisted as create-agent preferences, replacing the
 * previously hardcoded `provider: "mock"`. `mock` remains selectable for smoke
 * testing.
 *
 * clean-room-scope/sprints/sprint-030-integration-gap-closure/task-002
 * clean-room-scope/features/agent-providers.md, features/composer-ui.md
 */

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { useAgentMutation } from "../hooks/use-session-hooks.js";
import { useProviders } from "../hooks/use-providers.js";
import { useClient } from "../hooks/client-context.js";
import { useConnectionStatus } from "../providers/ConnectionProvider.js";
import { Button } from "../components/primitives/Button.js";
import { TextInput } from "../components/primitives/TextInput.js";
import { Select } from "../components/primitives/Select.js";
import { routes } from "../runtime/route-grammar.js";
import { createWebKVStore } from "../providers/kv-store.js";
import {
  resolveInitialSelection,
  modeOptionsFor,
  withSelectionPreference,
} from "../screens/provider-picker.js";
import type { CreateAgentPreferences } from "../screens/new-workspace.js";

const PREFS_KEY = "pi-studio.create-agent-prefs";
const kvStore = createWebKVStore();

function loadPrefs(): CreateAgentPreferences | undefined {
  const raw = kvStore.get(PREFS_KEY);
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as CreateAgentPreferences;
  } catch {
    return undefined;
  }
}

export function NewAgentPage() {
  const navigate = useNavigate();
  const client = useClient();
  const connection = useConnectionStatus();
  const { create } = useAgentMutation(client as unknown as Parameters<typeof useAgentMutation>[0]);
  const providersQuery = useProviders(client as unknown as Parameters<typeof useProviders>[0]);
  const options = useMemo(() => providersQuery.data ?? [], [providersQuery.data]);

  const [cwd, setCwd] = useState("/home/avatsaev/DEV/avatsaev/pi-studio");
  const [title, setTitle] = useState("");
  const [provider, setProvider] = useState<string>("");
  const [modeId, setModeId] = useState<string>("");

  // Seed the initial provider/mode from persisted preferences once providers load.
  useEffect(() => {
    if (options.length === 0 || provider) return;
    const initial = resolveInitialSelection(options, loadPrefs());
    setProvider(initial.provider);
    setModeId(initial.modeId ?? "");
  }, [options, provider]);

  const modeOptions = modeOptionsFor(options, provider);

  function handleProviderChange(next: string) {
    setProvider(next);
    const modes = modeOptionsFor(options, next);
    setModeId(modes[0]?.id ?? "");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!connection.serverId || !provider) return;
    // Persist last-used selection for next time.
    kvStore.set(PREFS_KEY, JSON.stringify(withSelectionPreference(loadPrefs(), { provider, modeId: modeId || undefined })));
    const result = await create.mutateAsync({
      config: {
        provider,
        cwd,
        title: title || undefined,
        ...(modeId ? { modeId } : {}),
      },
    });
    // Dev-mode 1:1 synthesis: workspaceId === agentId (see dev-bootstrap.ts).
    navigate(routes.workspace(connection.serverId, result.agentId));
  }

  return (
    <div style={{ padding: 24, maxWidth: 480 }}>
      <h2 style={{ marginTop: 0 }}>New session</h2>
      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 13, color: "var(--pi-color-foregroundMuted)" }}>Provider</span>
          <Select
            value={provider}
            onChange={(e) => handleProviderChange(e.target.value)}
            options={options.map((o) => ({ value: o.id, label: o.isProfile ? `${o.label} (profile)` : o.label }))}
            placeholder={providersQuery.isLoading ? "Loading providers…" : "Select a provider"}
          />
        </label>
        {modeOptions.length > 0 && (
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 13, color: "var(--pi-color-foregroundMuted)" }}>Profile / mode</span>
            <Select
              value={modeId}
              onChange={(e) => setModeId(e.target.value)}
              options={modeOptions.map((m) => ({ value: m.id, label: m.label }))}
            />
          </label>
        )}
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 13, color: "var(--pi-color-foregroundMuted)" }}>Working directory</span>
          <TextInput value={cwd} onChange={(e) => setCwd(e.target.value)} />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 13, color: "var(--pi-color-foregroundMuted)" }}>Title (optional)</span>
          <TextInput value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <Button type="submit" disabled={create.isPending || !connection.serverId || !provider}>
          {create.isPending ? "Creating…" : "Create session"}
        </Button>
        {create.isError && (
          <p style={{ color: "var(--pi-color-statusDanger)", fontSize: 13 }}>
            {(create.error as Error).message}
          </p>
        )}
      </form>
    </div>
  );
}
