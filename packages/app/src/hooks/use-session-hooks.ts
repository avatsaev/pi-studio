/**
 * Session selectors and React Query hooks for agent sessions.
 *
 * Provides fine-grained Zustand selectors (stable references via subscribeWithSelector)
 * and React Query hooks for CRUD operations via PiStudioClient.
 *
 * See: clean-room-scope/architecture/client-app-runtime.md § reactive subscriptions
 *      clean-room-scope/features/agent-sessions.md
 */

import { useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useShallow } from "zustand/react/shallow";
import { useSessionStore } from "../store/session-store.js";
import type {
  AgentEntry,
  AgentCapabilities,
  AgentPermission,
  OptimisticMessage,
  WorkspaceDescriptor,
  ServerInfoRecord,
} from "../store/session-store.js";
import type { AgentStatus } from "@av-pi-studio/protocol";

// ─── Context hook (client injected via AppProviders) ─────────────────────────

// Lazy import to avoid circular deps: the client context lives in providers.
// Components that need the raw client use useClient() from providers/index.
// We accept it as an explicit param in mutation hooks.

// ─── Zustand selectors ───────────────────────────────────────────────────────

/** Select the full agent entry or undefined. */
export function useAgentEntry(agentId: string | undefined): AgentEntry | undefined {
  return useSessionStore((s) => (agentId ? s.agents[agentId] : undefined));
}

/** Select just the agent status. Returns undefined if agent not in store. */
export function useAgentStatus(agentId: string | undefined): AgentStatus | undefined {
  return useSessionStore((s) => (agentId ? s.agents[agentId]?.status : undefined));
}

/** Select the agent's timeline state. */
export function useAgentTimeline(agentId: string | undefined) {
  return useSessionStore((s) => (agentId ? s.agents[agentId]?.timeline : undefined));
}

/** Select the agent's capabilities. */
export function useAgentCapabilities(agentId: string | undefined): AgentCapabilities {
  return useSessionStore((s) =>
    agentId ? (s.agents[agentId]?.capabilities ?? {}) : {},
  );
}

/** Select all pending permissions for an agent. */
export function useAgentPermissions(agentId: string | undefined): AgentPermission[] {
  return useSessionStore(
    useShallow((s) => {
      if (!agentId) return [];
      const perms = s.agents[agentId]?.permissions ?? {};
      return Object.values(perms).filter((p) => p.state === "pending");
    }),
  );
}

/** Select optimistic (unconfirmed) messages for an agent. */
export function useOptimisticMessages(agentId: string | undefined): OptimisticMessage[] {
  return useSessionStore(
    useShallow((s) => {
      if (!agentId) return [];
      return Object.values(s.agents[agentId]?.optimisticMessages ?? {});
    }),
  );
}

/** Select a workspace descriptor. */
export function useWorkspaceDescriptor(workspaceId: string | undefined): WorkspaceDescriptor | undefined {
  return useSessionStore((s) =>
    workspaceId ? s.workspaces[workspaceId] : undefined,
  );
}

/** Select all workspace descriptors as an array. */
export function useWorkspaceList(): WorkspaceDescriptor[] {
  return useSessionStore(useShallow((s) => Object.values(s.workspaces)));
}

/** Select server info by serverId. */
export function useServerInfo(serverId: string | undefined): ServerInfoRecord | undefined {
  return useSessionStore((s) =>
    serverId ? s.servers[serverId] : undefined,
  );
}

/** Select the active server id. */
export function useActiveServerId(): string | null {
  return useSessionStore((s) => s.activeServerId);
}

/** Select all agents as an array (optionally filtered by workspaceId). */
export function useAgentDirectory(workspaceId?: string): AgentEntry[] {
  return useSessionStore(
    useShallow((s) => {
      const all = Object.values(s.agents);
      if (workspaceId) return all.filter((a) => a.workspaceId === workspaceId);
      return all;
    }),
  );
}

// ─── Query keys ──────────────────────────────────────────────────────────────

export const SESSION_QUERY_KEYS = {
  sessions: (serverId: string) => ["sessions", serverId] as const,
  session: (agentId: string) => ["session", agentId] as const,
} as const;

// ─── React Query: sessions list ───────────────────────────────────────────────

export interface SessionListEntry {
  agentId: string;
  status: AgentStatus;
  title?: string;
  cwd?: string;
  workspaceId?: string;
  labels: Record<string, string>;
  lastActivity?: number;
}

/**
 * Fetch the session list from the daemon and populate the session store.
 * The daemon returns an agent directory via the `list_agents_request` RPC.
 * client is the PiStudioClient instance (passed explicitly to avoid circular deps).
 */
export function useSessionsQuery(
  serverId: string | undefined,
  client: { connection: { request<T>(type: string, payload?: unknown): Promise<T> } } | null,
) {
  const store = useSessionStore;

  return useQuery({
    queryKey: serverId ? SESSION_QUERY_KEYS.sessions(serverId) : ["sessions", "__none__"],
    queryFn: async (): Promise<SessionListEntry[]> => {
      if (!client || !serverId) return [];
      const resp = await client.connection.request<{ agents?: SessionListEntry[] }>(
        "list_agents_request",
        { serverId },
      );
      const agents: SessionListEntry[] = resp.agents ?? [];
      // Populate the session store from the fetched list
      for (const a of agents) {
        store.getState().upsertAgent({
          agentId: a.agentId,
          status: a.status,
          title: a.title,
          cwd: a.cwd,
          workspaceId: a.workspaceId,
          labels: a.labels,
          lastActivity: a.lastActivity,
        });
      }
      return agents;
    },
    enabled: !!client && !!serverId,
    staleTime: 10_000,
  });
}

// ─── React Query: agent mutations ────────────────────────────────────────────

export interface CreateAgentInput {
  config: {
    provider: string;
    cwd: string;
    modeId?: string;
    model?: string;
    title?: string;
  };
  workspaceId?: string;
  initialPrompt?: string;
  clientMessageId?: string;
}

export function useAgentMutation(
  client: { createAgent(req: CreateAgentInput): Promise<{ agentId: string }> } | null,
) {
  const qc = useQueryClient();

  const create = useMutation({
    mutationFn: async (input: CreateAgentInput) => {
      if (!client) throw new Error("No client");
      return client.createAgent(input);
    },
    onSuccess: (data) => {
      // Optimistically upsert the new agent
      useSessionStore.getState().upsertAgent({
        agentId: data.agentId,
        status: "initializing",
      });
      // Invalidate sessions queries so lists refetch
      qc.invalidateQueries({ queryKey: ["sessions"] });
    },
  });

  const stop = useMutation({
    mutationFn: async (agentId: string) => {
      if (!client) throw new Error("No client");
      return (client as unknown as {
        agent(id: string): { interrupt(): Promise<unknown> };
      })
        .agent(agentId)
        .interrupt();
    },
    onMutate: (agentId) => {
      useSessionStore.getState().setAgentStatus(agentId, "idle");
    },
  });

  const archive = useMutation({
    mutationFn: async (agentId: string) => {
      if (!client) throw new Error("No client");
      return (client as unknown as {
        agent(id: string): { archive(): Promise<unknown> };
      })
        .agent(agentId)
        .archive();
    },
    onSuccess: (_data, agentId) => {
      useSessionStore.getState().removeAgent(agentId);
      qc.invalidateQueries({ queryKey: ["sessions"] });
    },
  });

  return { create, stop, archive };
}

// ─── React Query: send message (with optimistic append) ──────────────────────

export interface SendMessageInput {
  agentId: string;
  prompt: string;
  clientMessageId: string;
  images?: unknown[];
}

export function useSendMessageMutation(
  client: {
    agent(id: string): { send(prompt: string, opts?: { clientMessageId?: string; images?: unknown[] }): Promise<unknown> };
  } | null,
) {
  return useMutation({
    mutationFn: async ({ agentId, prompt, clientMessageId, images }: SendMessageInput) => {
      if (!client) throw new Error("No client");
      return client.agent(agentId).send(prompt, { clientMessageId, images });
    },
    onMutate: ({ agentId, prompt, clientMessageId }) => {
      const msg: OptimisticMessage = {
        clientMessageId,
        text: prompt,
        timestamp: Date.now(),
      };
      useSessionStore.getState().addOptimisticMessage(agentId, msg);
      return { agentId, clientMessageId };
    },
    onSuccess: (_data, _vars, ctx) => {
      if (ctx) {
        useSessionStore.getState().confirmOptimisticMessage(ctx.agentId, ctx.clientMessageId);
      }
    },
    onError: (_err, _vars, ctx) => {
      if (ctx) {
        useSessionStore.getState().rollbackOptimisticMessage(ctx.agentId, ctx.clientMessageId);
      }
    },
  });
}

// ─── React Query: permission mutation ────────────────────────────────────────

export interface RespondPermissionInput {
  agentId: string;
  requestId: string;
  decision: string;
}

export function usePermissionMutation(
  client: {
    connection: {
      request<T>(type: string, payload?: unknown): Promise<T>;
    };
  } | null,
) {
  return useMutation({
    mutationFn: async ({ agentId, requestId, decision }: RespondPermissionInput) => {
      if (!client) throw new Error("No client");
      return client.connection.request("agent_permission_respond", {
        agentId,
        requestId,
        decision,
      });
    },
    onMutate: ({ agentId, requestId, decision }) => {
      useSessionStore.getState().resolvePermission(agentId, requestId, decision);
    },
  });
}

// ─── Store subscription helpers (for use outside React) ──────────────────────

/**
 * Subscribe the session store to a PiStudioClient instance.
 * Returns an unsubscribe function. Call this in the connection provider.
 */
export function subscribeSessionStore(client: {
  onAgentUpdate(handler: (msg: {
    agentId: string;
    status?: string;
    title?: string;
    labels?: Record<string, string>;
    capabilities?: Record<string, unknown>;
    workspaceId?: string;
    cwd?: string;
    [key: string]: unknown;
  }) => void): () => void;
  connection: {
    onSessionMessage(handler: (msg: unknown) => void): () => void;
  };
}): () => void {
  const store = useSessionStore.getState();

  // agent_update → upsert into store
  const unsubAgentUpdate = client.onAgentUpdate((msg) => {
    store.upsertAgent({
      agentId: msg.agentId,
      ...(msg.status !== undefined && { status: msg.status as AgentStatus }),
      ...(msg.title !== undefined && { title: msg.title }),
      ...(msg.labels !== undefined && { labels: msg.labels }),
      ...(msg.capabilities !== undefined && { capabilities: msg.capabilities }),
      ...(msg.workspaceId !== undefined && { workspaceId: msg.workspaceId }),
      ...(msg.cwd !== undefined && { cwd: msg.cwd }),
    });
  });

  // agent_stream → apply live row
  const unsubStream = client.connection.onSessionMessage((rawMsg: unknown) => {
    const msg = rawMsg as Record<string, unknown>;
    if (msg["type"] === "agent_stream") {
      const agentId = msg["agentId"] as string | undefined;
      const event = msg["event"] as Record<string, unknown> | undefined;
      if (agentId && event) {
        store.applyStreamEvent(agentId, event as never);
      }
    }

    if (msg["type"] === "agent_usage" || msg["type"] === "agent_usage_update") {
      const agentId = msg["agentId"] as string | undefined;
      const usage = msg["usage"] as Record<string, unknown> | undefined;
      if (agentId && usage) {
        store.setAgentUsage(agentId, {
          inputTokens: usage["inputTokens"] as number | undefined,
          outputTokens: usage["outputTokens"] as number | undefined,
          cachedTokens: usage["cachedTokens"] as number | undefined,
          costUsd: usage["costUsd"] as number | undefined,
          provider: usage["provider"] as string | undefined,
        });
      }
    }

    if (msg["type"] === "agent_permission_request") {
      const agentId = msg["agentId"] as string | undefined;
      const requestId = msg["requestId"] as string | undefined;
      if (agentId && requestId) {
        store.addPermission(agentId, {
          requestId,
          agentId,
          toolName: msg["toolName"] as string | undefined,
          tool: msg["tool"],
          action: msg["action"],
          responses: msg["responses"] as string[] | undefined,
          state: "pending",
        });
      }
    }

    if (msg["type"] === "agent_permission_resolved") {
      const agentId = msg["agentId"] as string | undefined;
      const requestId = msg["requestId"] as string | undefined;
      const decision = msg["decision"] as string | undefined;
      if (agentId && requestId && decision) {
        store.resolvePermission(agentId, requestId, decision);
      }
    }

    if (msg["type"] === "workspace_update") {
      const ws = msg as WorkspaceDescriptor & { type: string };
      if (ws.workspaceId) {
        store.upsertWorkspace({
          workspaceId: ws.workspaceId,
          name: ws.name ?? ws.workspaceId,
          cwd: ws.cwd,
          agentIds: ws.agentIds ?? [],
          projectId: ws.projectId,
        });
      }
    }
  });

  return () => {
    unsubAgentUpdate();
    unsubStream();
  };
}
