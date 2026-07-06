// Per-agent composer message queue store (Zustand).
//
// Holds messages the user submitted while an agent was running. When the agent
// transitions to idle, queued messages are flushed (auto-sent) in FIFO order.
//
// clean-room-scope/features/composer-ui.md § Queue (agent running)
//
// NOTE(deviation): the scope says "Per-agent queued messages live in the
// session store." We keep them in a dedicated small store instead, reusing the
// pure `queue.ts` models, to avoid widening the append-only session-store
// contract. The observable behavior (per-agent FIFO queue, edit, send-now,
// reinsert-at-front on failure, flush-on-idle) is identical. TODO(verify).

import { create } from "zustand";
import {
  enqueue as enqueueMsg,
  dequeueById,
  editQueuedMessage as editQueuedMsg,
  reinsertAtFront as reinsertFront,
  flushQueue as flushQueueModel,
  type MessageQueue,
  type QueuedMessage,
} from "./queue.js";

function emptyQueue(agentId: string): MessageQueue {
  return { agentId, messages: [] };
}

export interface ComposerQueueState {
  /** Per-agent queues keyed by agentId. */
  queues: Record<string, MessageQueue>;
}

export interface ComposerQueueActions {
  /** Append a message to the given agent's queue. */
  enqueue(agentId: string, message: QueuedMessage): void;
  /** Remove a queued message by id; returns the removed message (or undefined). */
  remove(agentId: string, messageId: string): QueuedMessage | undefined;
  /** Remove a queued message and return its editable text + attachments. */
  edit(agentId: string, messageId: string): { text: string; attachments: QueuedMessage["attachments"] };
  /** Re-insert a message at the FRONT of the queue (send-now failure recovery). */
  reinsertAtFront(agentId: string, message: QueuedMessage): void;
  /** Empty an agent's queue and return the flushed messages in FIFO order. */
  flush(agentId: string): QueuedMessage[];
  /** Read (non-reactive) the current queue for an agent. */
  peek(agentId: string): QueuedMessage[];
  /** Drop an agent's queue entirely (e.g. on archive). */
  clear(agentId: string): void;
}

export type ComposerQueueStore = ComposerQueueState & ComposerQueueActions;

export const useComposerQueueStore = create<ComposerQueueStore>((set, get) => ({
  queues: {},

  enqueue(agentId, message) {
    set((s) => {
      const q = s.queues[agentId] ?? emptyQueue(agentId);
      return { queues: { ...s.queues, [agentId]: enqueueMsg(q, message) } };
    });
  },

  remove(agentId, messageId) {
    const q = get().queues[agentId] ?? emptyQueue(agentId);
    const { queue, removed } = dequeueById(q, messageId);
    set((s) => ({ queues: { ...s.queues, [agentId]: queue } }));
    return removed;
  },

  edit(agentId, messageId) {
    const q = get().queues[agentId] ?? emptyQueue(agentId);
    const { queue, text, attachments } = editQueuedMsg(q, messageId);
    set((s) => ({ queues: { ...s.queues, [agentId]: queue } }));
    return { text, attachments };
  },

  reinsertAtFront(agentId, message) {
    set((s) => {
      const q = s.queues[agentId] ?? emptyQueue(agentId);
      return { queues: { ...s.queues, [agentId]: reinsertFront(q, message) } };
    });
  },

  flush(agentId) {
    const q = get().queues[agentId] ?? emptyQueue(agentId);
    const { queue, flushed } = flushQueueModel(q);
    set((s) => ({ queues: { ...s.queues, [agentId]: queue } }));
    return flushed;
  },

  peek(agentId) {
    return get().queues[agentId]?.messages ?? [];
  },

  clear(agentId) {
    set((s) => {
      const { [agentId]: _drop, ...rest } = s.queues;
      return { queues: rest };
    });
  },
}));
