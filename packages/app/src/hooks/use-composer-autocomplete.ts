/**
 * Composer autocomplete + agent mode-control hooks.
 *
 * `useComposerAutocomplete` sources `/` commands (client + provider) and `@`
 * file mentions (from the workspace directory listing) for a given agent.
 * `useAgentModeControl` reads the agent's available modes and pushes
 * mode/model changes to the daemon via `agent.config.update`.
 *
 * clean-room-scope/features/composer-ui.md § Slash-command & file-mention
 *   autocomplete, § Provider / model / mode / feature controls
 */

import { useCallback, useMemo } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  mergeSlashCommands,
  fuzzyMatchFiles,
  providerModesToOptions,
  buildAgentConfigUpdate,
  type FileMentionEntry,
  type ModeOption,
  type AgentConfigUpdate,
} from "../composer/autocomplete-sources.js";
import type { SlashCommandOption } from "../composer/autocomplete.js";
import { useSessionStore } from "../store/session-store.js";
import { useClient } from "./client-context.js";
import { useDirectoryListing, type FileEntry } from "./use-explorer-hooks.js";

// ─── Autocomplete sources ──────────────────────────────────────────────────

export interface ComposerAutocompleteData {
  providerCommands: SlashCommandOption[];
  fileEntries: FileMentionEntry[];
}

/**
 * Gather the provider commands + workspace file entries used to feed the
 * composer autocomplete popover. `cwd` is the agent/workspace working dir.
 */
export function useComposerAutocomplete(
  serverId: string | undefined,
  agentId: string | undefined,
  cwd: string | undefined,
  client: Parameters<typeof useDirectoryListing>[2],
): ComposerAutocompleteData {
  const capabilities = useSessionStore((s) => (agentId ? s.agents[agentId]?.capabilities : undefined));
  const listing = useDirectoryListing(serverId, cwd, client);

  const providerCommands = useMemo<SlashCommandOption[]>(() => {
    const raw = (capabilities as { commands?: unknown } | undefined)?.commands;
    if (!Array.isArray(raw)) return [];
    const out: SlashCommandOption[] = [];
    for (const c of raw) {
      const o = c as { name?: unknown; description?: unknown; argumentHint?: unknown };
      if (typeof o.name !== "string") continue;
      out.push({
        name: o.name,
        description: typeof o.description === "string" ? o.description : "",
        argumentHint: typeof o.argumentHint === "string" ? o.argumentHint : undefined,
      });
    }
    return out;
  }, [capabilities]);

  const fileEntries = useMemo<FileMentionEntry[]>(() => {
    const entries: FileEntry[] = listing.data?.entries ?? [];
    return entries.map((e) => ({ path: e.path, kind: e.kind, name: e.name }));
  }, [listing.data]);

  return { providerCommands, fileEntries };
}

// Re-export the pure matchers so callers can compose them without a second import.
export { mergeSlashCommands, fuzzyMatchFiles };

// ─── Agent mode control ────────────────────────────────────────────────────

export interface AgentModeControl {
  modes: ModeOption[];
  currentModeId: string | undefined;
  currentModel: string | undefined;
  /** Push a mode/model change to the daemon (toasts handled by caller). */
  update(input: AgentConfigUpdate): Promise<void>;
}

export function useAgentModeControl(
  agentId: string | undefined,
  availableModes: readonly import("@av-pi-studio/protocol").ProviderMode[] = [],
): AgentModeControl {
  const client = useClient();
  const entry = useSessionStore((s) => (agentId ? s.agents[agentId] : undefined));

  const modes = useMemo(() => providerModesToOptions(availableModes), [availableModes]);

  const mutation = useMutation({
    mutationFn: async (input: AgentConfigUpdate) => {
      if (!client || !agentId) throw new Error("No client / agent");
      const payload = buildAgentConfigUpdate(input);
      return (client as unknown as {
        agent(id: string): { update(patch: unknown): Promise<unknown> };
      })
        .agent(agentId)
        .update(payload);
    },
    onMutate: (input) => {
      if (!agentId) return;
      const patch: Partial<{ model: string }> = {};
      if (input.model !== undefined) patch.model = input.model;
      useSessionStore.getState().upsertAgent({ agentId, ...patch });
    },
  });

  const update = useCallback(
    async (input: AgentConfigUpdate) => {
      await mutation.mutateAsync(input);
    },
    [mutation],
  );

  return {
    modes,
    currentModeId: (entry as { modeId?: string } | undefined)?.modeId,
    currentModel: entry?.model,
    update,
  };
}
