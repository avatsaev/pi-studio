// Per-agent queued message store.
// clean-room-scope/features/composer-ui.md § Queue (agent running)

import type { DraftAttachmentMeta } from "./draft-store.js";

export type QueuedMessage = {
  id: string;
  text: string;
  attachments: DraftAttachmentMeta[];
};

export type MessageQueue = {
  agentId: string;
  messages: QueuedMessage[];
};

export function enqueue(queue: MessageQueue, message: QueuedMessage): MessageQueue {
  return { ...queue, messages: [...queue.messages, message] };
}

export function dequeueById(queue: MessageQueue, messageId: string): { queue: MessageQueue; removed: QueuedMessage | undefined } {
  const removed = queue.messages.find((m) => m.id === messageId);
  return { queue: { ...queue, messages: queue.messages.filter((m) => m.id !== messageId) }, removed };
}

export function editQueuedMessage(queue: MessageQueue, messageId: string): { queue: MessageQueue; text: string; attachments: DraftAttachmentMeta[] } {
  const { queue: next, removed } = dequeueById(queue, messageId);
  return { queue: next, text: removed?.text ?? "", attachments: removed?.attachments ?? [] };
}

export function reinsertAtFront(queue: MessageQueue, message: QueuedMessage): MessageQueue {
  return { ...queue, messages: [message, ...queue.messages] };
}

export function flushQueue(queue: MessageQueue): { queue: MessageQueue; flushed: QueuedMessage[] } {
  return { queue: { ...queue, messages: [] }, flushed: queue.messages };
}

export function isQueueEmpty(queue: MessageQueue): boolean {
  return queue.messages.length === 0;
}
