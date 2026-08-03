/**
 * Session store — replaces the POC's `sessions[]`/`activeSessionId` globals
 * (POC_TO_APP_PLAN_UI.md §4.3). Kills the POC's `expectingAgent` race: a session only subscribes
 * to `agent(id).timeline.subscribe` once `agentId` is bound (from the `createAgent` response),
 * so no event can arrive before the session that owns it is known — no guessing required.
 */

import { create } from "zustand";
import type { AgentStatus } from "@av-pi-studio/protocol";
import {
  EMPTY_TIMELINE,
  applyStreamEvent as applyStreamEventToTimeline,
  addOptimisticUserMessage as addOptimisticUserMessageToTimeline,
  markUserMessageFailed as markUserMessageFailedInTimeline,
} from "@pi-studio-ui/timeline/reducer.js";
import type { TimelineState } from "@pi-studio-ui/timeline/reducer.js";
import type { AgentStreamEvent } from "@av-pi-studio/protocol";

export interface SessionEntry {
  id: string;
  agentId: string | null;
  title: string;
  status: AgentStatus | "idle";
  cwd: string;
  timeline: TimelineState;
  /** User-turn count, for the sidebar meta line (POC: `messages.filter(role==='user').length`). */
  userMessageCount: number;
  /** Current model id, shown by the workspace status bar's model segment (sprint-042). Seeded
   * from the preselected default (`materialize.ts` `resolveDefaultModel`) or create-agent config
   * / a restored `list_agents` entry, updated live by an `agent_update({model})` broadcast, and
   * reconciled by the periodic session-stats poll. */
  model?: string;
  /** The current model's own underlying LLM provider (e.g. `"anthropic"`) — travels alongside
   * `model` so a materialized draft can pin `config.modelProvider` for first-spawn replay
   * (`agent-service.ts` `spawnOrResumeSession`) without a second round trip to re-derive it. */
  modelProvider?: string;
}

interface SessionStoreState {
  sessions: Record<string, SessionEntry>;
  order: string[];
  activeSessionId: string | null;

  createSession(cwd: string): string;
  bindAgent(sessionId: string, agentId: string): void;
  setStatus(sessionId: string, status: AgentStatus | "idle"): void;
  setStatusByAgentId(agentId: string, status: AgentStatus | "idle"): void;
  setModel(sessionId: string, model: string | undefined, modelProvider?: string): void;
  setModelByAgentId(agentId: string, model: string | undefined, modelProvider?: string): void;
  setTitle(sessionId: string, title: string): void;
  setCwd(sessionId: string, cwd: string): void;
  applyStreamEvent(sessionId: string, event: AgentStreamEvent): void;
  addOptimisticUserMessage(
    sessionId: string,
    clientMessageId: string,
    text: string,
    images?: Array<{ mimeType?: string; data?: string }>,
    queued?: boolean,
  ): void;
  markUserMessageFailed(sessionId: string, clientMessageId: string): void;
  activate(sessionId: string): void;
  remove(sessionId: string): void;
  /** Register a restored session (session restore on connect, §4.3 "Session restore"). */
  hydrate(entry: SessionEntry): void;
  findByAgentId(agentId: string): SessionEntry | undefined;
}

let sessionSeq = 0;
function newSessionId(): string {
  sessionSeq += 1;
  return `s-${Date.now().toString(36)}-${sessionSeq}`;
}

export const useSessionStore = create<SessionStoreState>()((set, get) => ({
  sessions: {},
  order: [],
  activeSessionId: null,

  createSession(cwd) {
    const id = newSessionId();
    const entry: SessionEntry = {
      id,
      agentId: null,
      title: "New chat",
      status: "idle",
      cwd,
      timeline: EMPTY_TIMELINE,
      userMessageCount: 0,
    };
    set((s) => ({
      sessions: { ...s.sessions, [id]: entry },
      order: [id, ...s.order],
      activeSessionId: id,
    }));
    return id;
  },

  hydrate(entry) {
    set((s) => {
      if (s.sessions[entry.id]) return s; // already known — don't clobber live state
      return {
        sessions: { ...s.sessions, [entry.id]: entry },
        order: [...s.order, entry.id],
      };
    });
  },

  bindAgent(sessionId, agentId) {
    set((s) => {
      const entry = s.sessions[sessionId];
      if (!entry) return s;
      return { sessions: { ...s.sessions, [sessionId]: { ...entry, agentId } } };
    });
  },

  setStatus(sessionId, status) {
    set((s) => {
      const entry = s.sessions[sessionId];
      if (!entry) return s;
      return { sessions: { ...s.sessions, [sessionId]: { ...entry, status } } };
    });
  },

  setStatusByAgentId(agentId, status) {
    const entry = get().findByAgentId(agentId);
    if (entry) get().setStatus(entry.id, status);
  },

  setModel(sessionId, model, modelProvider) {
    set((s) => {
      const entry = s.sessions[sessionId];
      if (!entry) return s;
      return { sessions: { ...s.sessions, [sessionId]: { ...entry, model, modelProvider } } };
    });
  },

  setModelByAgentId(agentId, model, modelProvider) {
    const entry = get().findByAgentId(agentId);
    if (entry) get().setModel(entry.id, model, modelProvider);
  },

  setTitle(sessionId, title) {
    set((s) => {
      const entry = s.sessions[sessionId];
      if (!entry) return s;
      return { sessions: { ...s.sessions, [sessionId]: { ...entry, title } } };
    });
  },

  setCwd(sessionId, cwd) {
    set((s) => {
      const entry = s.sessions[sessionId];
      if (!entry) return s;
      return { sessions: { ...s.sessions, [sessionId]: { ...entry, cwd } } };
    });
  },

  applyStreamEvent(sessionId, event) {
    set((s) => {
      const entry = s.sessions[sessionId];
      if (!entry) return s;
      const timeline = applyStreamEventToTimeline(entry.timeline, event);
      let title = entry.title;
      if (event.kind === "turn_completed" && title === "New chat") {
        const lastAssistant = timeline.rows
          .slice()
          .reverse()
          .find((r) => r.kind === "assistant");
        if (lastAssistant && lastAssistant.kind === "assistant" && lastAssistant.text) {
          title = lastAssistant.text.slice(0, 40) + (lastAssistant.text.length > 40 ? "…" : "");
        }
      }
      return { sessions: { ...s.sessions, [sessionId]: { ...entry, timeline, title } } };
    });
  },

  addOptimisticUserMessage(sessionId, clientMessageId, text, images, queued) {
    set((s) => {
      const entry = s.sessions[sessionId];
      if (!entry) return s;
      const timeline = addOptimisticUserMessageToTimeline(
        entry.timeline,
        clientMessageId,
        text,
        images,
        queued,
      );
      return {
        sessions: {
          ...s.sessions,
          [sessionId]: { ...entry, timeline, userMessageCount: entry.userMessageCount + 1 },
        },
      };
    });
  },

  markUserMessageFailed(sessionId, clientMessageId) {
    set((s) => {
      const entry = s.sessions[sessionId];
      if (!entry) return s;
      const timeline = markUserMessageFailedInTimeline(entry.timeline, clientMessageId);
      return { sessions: { ...s.sessions, [sessionId]: { ...entry, timeline } } };
    });
  },

  activate(sessionId) {
    set({ activeSessionId: sessionId });
  },

  remove(sessionId) {
    set((s) => {
      const { [sessionId]: _removed, ...rest } = s.sessions;
      const order = s.order.filter((id) => id !== sessionId);
      const activeSessionId =
        s.activeSessionId === sessionId ? (order[0] ?? null) : s.activeSessionId;
      return { sessions: rest, order, activeSessionId };
    });
  },

  findByAgentId(agentId) {
    return Object.values(get().sessions).find((s) => s.agentId === agentId);
  },
}));
