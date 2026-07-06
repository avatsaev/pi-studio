/**
 * Session store — Zustand + subscribeWithSelector.
 *
 * Central data backbone for agent lifecycle, stream items, permissions,
 * capabilities, usage, workspace descriptors, and server info.
 *
 * Driven by daemon broadcast events via the PiStudioClient event handlers.
 * See: clean-room-scope/architecture/client-app-runtime.md § session store
 *      clean-room-scope/features/agent-sessions.md § stream events
 */

import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import type { AgentStatus, AgentStreamEvent } from "@av-pi-studio/protocol";
import {
  EMPTY_TIMELINE,
  applyLiveRow,
  compactDelta,
  mergePageRows,
  streamEventToTimelineRow,
  type TimelineState,
  type TimelineRow,
  type PageResult,
} from "../timeline/reducer.js";

// ─── Per-agent state ──────────────────────────────────────────────────────────

export interface AgentPermission {
  requestId: string;
  agentId: string;
  toolName?: string;
  tool?: unknown;
  action?: unknown;
  responses?: string[];
  /** "pending" | "resolved" | "auto-approved" */
  state: "pending" | "resolved" | "auto-approved";
  decision?: string;
}

export interface AgentCapabilities {
  rewind?: boolean;
  rewindModes?: string[];
  [key: string]: unknown;
}

export interface AgentUsage {
  inputTokens?: number;
  outputTokens?: number;
  cachedTokens?: number;
  costUsd?: number;
  provider?: string;
}

export interface AgentEntry {
  agentId: string;
  status: AgentStatus;
  title?: string;
  labels: Record<string, string>;
  cwd?: string;
  workspaceId?: string;
  provider?: string;
  model?: string;
  capabilities: AgentCapabilities;
  usage?: AgentUsage;
  permissions: Record<string, AgentPermission>; // keyed by requestId
  timeline: TimelineState;
  lastActivity: number; // epoch ms
  /** Optimistic user messages not yet confirmed by server (keyed by clientMessageId) */
  optimisticMessages: Record<string, OptimisticMessage>;
}

export interface OptimisticMessage {
  clientMessageId: string;
  text: string;
  timestamp: number;
}

// ─── Workspace descriptor ─────────────────────────────────────────────────────

export interface WorkspaceDescriptor {
  workspaceId: string;
  name: string;
  cwd?: string;
  agentIds: string[];
  projectId?: string;
  [key: string]: unknown;
}

// ─── Server info ──────────────────────────────────────────────────────────────

export interface ServerInfoRecord {
  serverId: string;
  version?: string;
  capabilities?: Record<string, unknown>;
  [key: string]: unknown;
}

// ─── Store shape ──────────────────────────────────────────────────────────────

export interface SessionStoreState {
  /** All known agents by agentId. */
  agents: Record<string, AgentEntry>;
  /** All known workspace descriptors by workspaceId. */
  workspaces: Record<string, WorkspaceDescriptor>;
  /** Server info by serverId. */
  servers: Record<string, ServerInfoRecord>;
  /** The most-recently-active serverId. */
  activeServerId: string | null;
}

export interface SessionStoreActions {
  // Agent lifecycle
  upsertAgent(entry: Partial<AgentEntry> & { agentId: string }): void;
  removeAgent(agentId: string): void;
  setAgentStatus(agentId: string, status: AgentStatus): void;

  // Usage
  setAgentUsage(agentId: string, usage: AgentUsage): void;

  // Timeline
  applyStreamEvent(agentId: string, event: AgentStreamEvent): void;
  mergePage(agentId: string, page: PageResult): void;
  resetTimeline(agentId: string): void;
  /** Drop all timeline rows at/after the row matching messageId (post-rewind). */
  truncateTimelineAfter(agentId: string, messageId: string): void;

  // Permissions
  addPermission(agentId: string, permission: AgentPermission): void;
  resolvePermission(agentId: string, requestId: string, decision: string): void;

  // Optimistic messages
  addOptimisticMessage(agentId: string, msg: OptimisticMessage): void;
  confirmOptimisticMessage(agentId: string, clientMessageId: string): void;
  rollbackOptimisticMessage(agentId: string, clientMessageId: string): void;

  // Workspaces
  upsertWorkspace(ws: WorkspaceDescriptor): void;
  removeWorkspace(workspaceId: string): void;

  // Server
  setServerInfo(info: ServerInfoRecord): void;
  setActiveServer(serverId: string | null): void;

  // Bulk reset (e.g. on disconnect)
  clearAllAgents(): void;
}

export type SessionStore = SessionStoreState & SessionStoreActions;

// ─── Helper: convert an AgentStreamEvent to a TimelineRow ────────────────────

function streamEventToRow(event: AgentStreamEvent, seq: number): TimelineRow | null {
  return streamEventToTimelineRow(event, { seq, source: "live" });
}

// Merge streaming token deltas into an existing live assistant/reasoning row.
function mergeStreamingRow(
  rows: readonly TimelineRow[],
  row: TimelineRow,
  event: AgentStreamEvent,
): TimelineRow {
  if (row.kind !== "assistant_message" && row.kind !== "thought") return row;
  const e = event as Record<string, unknown>;
  const delta = e["delta"];
  const hasFullText = typeof e["text"] === "string";
  const streaming = e["done"] !== true && e["complete"] !== true && e["final"] !== true;

  const existing = rows.find((r) => r.rowId === row.rowId);
  const prevText = (existing?.payload as { text?: string } | undefined)?.text ?? "";

  let text: string;
  if (typeof delta === "string" && !hasFullText) {
    text = prevText + delta;
  } else {
    text = (e["text"] as string | undefined) ?? prevText;
  }

  const payload = { ...(row.payload as Record<string, unknown>), text, streaming };
  return { ...row, payload };
}

// ─── Default agent entry ──────────────────────────────────────────────────────

function defaultAgent(agentId: string): AgentEntry {
  return {
    agentId,
    status: "initializing",
    labels: {},
    capabilities: {},
    permissions: {},
    timeline: EMPTY_TIMELINE,
    lastActivity: Date.now(),
    optimisticMessages: {},
  };
}

// ─── Store creation ───────────────────────────────────────────────────────────

export const useSessionStore = create<SessionStore>()(
  subscribeWithSelector((set, get) => ({
    agents: {},
    workspaces: {},
    servers: {},
    activeServerId: null,

    // ── Agent lifecycle ──────────────────────────────────────────────────────

    upsertAgent(entry) {
      set((s) => {
        const existing = s.agents[entry.agentId] ?? defaultAgent(entry.agentId);
        const updated: AgentEntry = {
          ...existing,
          ...entry,
          labels: { ...existing.labels, ...(entry.labels ?? {}) },
          capabilities: { ...existing.capabilities, ...(entry.capabilities ?? {}) },
          permissions: existing.permissions,
          timeline: existing.timeline,
          optimisticMessages: existing.optimisticMessages,
          lastActivity: Date.now(),
        };
        return { agents: { ...s.agents, [entry.agentId]: updated } };
      });
    },

    removeAgent(agentId) {
      set((s) => {
        const { [agentId]: _, ...agents } = s.agents;
        return { agents };
      });
    },

    setAgentUsage(agentId, usage) {
      set((s) => {
        const existing = s.agents[agentId] ?? defaultAgent(agentId);
        return {
          agents: {
            ...s.agents,
            [agentId]: { ...existing, usage: { ...existing.usage, ...usage } },
          },
        };
      });
    },

    setAgentStatus(agentId, status) {
      set((s) => {
        const existing = s.agents[agentId];
        if (!existing) return {};
        return {
          agents: {
            ...s.agents,
            [agentId]: { ...existing, status, lastActivity: Date.now() },
          },
        };
      });
    },

    // ── Timeline ─────────────────────────────────────────────────────────────

    applyStreamEvent(agentId, event) {
      set((s) => {
        const agent = s.agents[agentId];
        if (!agent) return {};
        const rows = agent.timeline.rows;
        // Determine the sequence for this event. Live inner events carry no
        // seq (the envelope's seq is dropped by the client), so assign a
        // monotonic one: reuse the existing row's seq for streaming deltas
        // (same rowId), otherwise append after the current max.
        const e = event as unknown as Record<string, unknown>;
        const probe = streamEventToTimelineRow(event, { seq: 0, source: "live" });
        if (!probe) return {};
        const existing = rows.find((r) => r.rowId === probe.rowId);
        const explicitSeq = typeof e["seq"] === "number" ? (e["seq"] as number) : undefined;
        const seq =
          explicitSeq ??
          (existing ? existing.seqStart : rows.reduce((m, r) => Math.max(m, r.seqEnd), -1) + 1);
        const row = streamEventToRow(event, seq);
        if (!row) return {};
        // Accumulate streaming token deltas for assistant/reasoning rows: if a
        // live row with the same id already exists and the incoming event
        // carries a `delta` (rather than full `text`), append it and keep the
        // streaming flag set until an explicit completion.
        const merged = mergeStreamingRow(agent.timeline.rows, row, event);
        const timeline = applyLiveRow(agent.timeline, merged);
        return {
          agents: {
            ...s.agents,
            [agentId]: { ...agent, timeline, lastActivity: Date.now() },
          },
        };
      });
    },

    mergePage(agentId, page) {
      set((s) => {
        const agent = s.agents[agentId];
        if (!agent) return {};
        const timeline = mergePageRows(agent.timeline, page);
        return {
          agents: { ...s.agents, [agentId]: { ...agent, timeline } },
        };
      });
    },

    resetTimeline(agentId) {
      set((s) => {
        const agent = s.agents[agentId];
        if (!agent) return {};
        return {
          agents: {
            ...s.agents,
            [agentId]: { ...agent, timeline: EMPTY_TIMELINE },
          },
        };
      });
    },

    truncateTimelineAfter(agentId, messageId) {
      set((s) => {
        const agent = s.agents[agentId];
        if (!agent) return {};
        const rows = agent.timeline.rows;
        const idx = rows.findIndex(
          (r) => r.rowId === messageId || (r.payload as { messageId?: string } | undefined)?.messageId === messageId,
        );
        if (idx < 0) return {};
        const kept = rows.slice(0, idx);
        return {
          agents: {
            ...s.agents,
            [agentId]: { ...agent, timeline: { ...agent.timeline, rows: kept } },
          },
        };
      });
    },

    // ── Permissions ──────────────────────────────────────────────────────────

    addPermission(agentId, permission) {
      set((s) => {
        const agent = s.agents[agentId];
        if (!agent) return {};
        return {
          agents: {
            ...s.agents,
            [agentId]: {
              ...agent,
              permissions: { ...agent.permissions, [permission.requestId]: permission },
            },
          },
        };
      });
    },

    resolvePermission(agentId, requestId, decision) {
      set((s) => {
        const agent = s.agents[agentId];
        if (!agent) return {};
        const existing = agent.permissions[requestId];
        if (!existing) return {};
        return {
          agents: {
            ...s.agents,
            [agentId]: {
              ...agent,
              permissions: {
                ...agent.permissions,
                [requestId]: { ...existing, state: "resolved", decision },
              },
            },
          },
        };
      });
    },

    // ── Optimistic messages ──────────────────────────────────────────────────

    addOptimisticMessage(agentId, msg) {
      set((s) => {
        const agent = s.agents[agentId];
        if (!agent) return {};
        return {
          agents: {
            ...s.agents,
            [agentId]: {
              ...agent,
              optimisticMessages: {
                ...agent.optimisticMessages,
                [msg.clientMessageId]: msg,
              },
            },
          },
        };
      });
    },

    confirmOptimisticMessage(agentId, clientMessageId) {
      set((s) => {
        const agent = s.agents[agentId];
        if (!agent) return {};
        const { [clientMessageId]: _, ...optimisticMessages } = agent.optimisticMessages;
        return {
          agents: { ...s.agents, [agentId]: { ...agent, optimisticMessages } },
        };
      });
    },

    rollbackOptimisticMessage(agentId, clientMessageId) {
      // Same as confirm (remove the optimistic entry); the UI stops rendering it.
      get().confirmOptimisticMessage(agentId, clientMessageId);
    },

    // ── Workspaces ───────────────────────────────────────────────────────────

    upsertWorkspace(ws) {
      set((s) => ({
        workspaces: { ...s.workspaces, [ws.workspaceId]: ws },
      }));
    },

    removeWorkspace(workspaceId) {
      set((s) => {
        const { [workspaceId]: _, ...workspaces } = s.workspaces;
        return { workspaces };
      });
    },

    // ── Server ───────────────────────────────────────────────────────────────

    setServerInfo(info) {
      set((s) => ({
        servers: { ...s.servers, [info.serverId]: info },
      }));
    },

    setActiveServer(serverId) {
      set({ activeServerId: serverId });
    },

    // ── Bulk reset ───────────────────────────────────────────────────────────

    clearAllAgents() {
      set({ agents: {} });
    },
  })),
);
