// Framework-agnostic composer submission pipeline.
//
// Ties the pure models (`resolveSubmitDecision`, optimistic message,
// per-agent queue) to side-effecting dependencies (client RPC, session store,
// draft store, queue store, toast). Kept free of React so it can be unit
// tested directly in the node test environment; the `useComposerController`
// hook is a thin wrapper around these functions.
//
// clean-room-scope/features/composer-ui.md § Sendable content & the submit
//   decision, § Create vs continue, § Queue (agent running),
//   § Error Handling & Edge Cases

import { resolveSubmitDecision, type SubmitDecision } from "./submit.js";
import type { DraftAttachmentMeta } from "./draft-store.js";
import type { QueuedMessage } from "./queue.js";
import { buildSendAttachments, type StoredImage } from "./attachments.js";

// ─── Dependency shapes (structural, for easy faking in tests) ────────────────

export interface OptimisticSink {
  addOptimisticMessage(agentId: string, msg: { clientMessageId: string; text: string; timestamp: number }): void;
  confirmOptimisticMessage(agentId: string, clientMessageId: string): void;
  rollbackOptimisticMessage(agentId: string, clientMessageId: string): void;
}

export interface DraftSink {
  /** Clear the draft after a successful/queued submit (lifecycle → sent). */
  markSent(draftKey: string): void;
  /** Restore text (+ mark active) after a failed send. */
  restore(draftKey: string, text: string): void;
}

export interface QueueSink {
  enqueue(agentId: string, message: QueuedMessage): void;
  reinsertAtFront(agentId: string, message: QueuedMessage): void;
  flush(agentId: string): QueuedMessage[];
}

export interface AgentSender {
  send(
    prompt: string,
    opts?: { clientMessageId?: string; images?: unknown[] },
  ): Promise<unknown>;
}

export interface SubmissionDeps {
  /** Resolve the agent's send transport (undefined ⇒ cannot send internally). */
  getSender(agentId: string): AgentSender | undefined;
  optimistic: OptimisticSink;
  drafts: DraftSink;
  queue: QueueSink;
  /** Show a user-facing error (send failures). */
  toastError(message: string): void;
  /** Generate a unique client message id. */
  newId(): string;
  now?(): number;
  /**
   * Resolve image attachment bytes (by storageKey) for serialization. Optional
   * — when absent, images are sent as an empty list (metadata-only drafts).
   */
  resolveImages?(attachments: DraftAttachmentMeta[]): Promise<Record<string, StoredImage>>;
}

// ─── Submission ──────────────────────────────────────────────────────────────

export interface SubmissionInput {
  agentId: string;
  draftKey: string;
  text: string;
  attachments: DraftAttachmentMeta[];
  agentRunning: boolean;
  forceSubmit: boolean;
  /** Whether a send transport exists / the composer may submit. */
  canSubmit: boolean;
}

export type SubmissionOutcome =
  | { decision: "noop" }
  | { decision: "queued"; messageId: string }
  | { decision: "submitted"; clientMessageId: string }
  | { decision: "failed"; clientMessageId: string; error: string };

/** Split attachments into image bytes vs. metadata-only (review/github/browser). */
export function splitAttachments(attachments: DraftAttachmentMeta[]): {
  images: DraftAttachmentMeta[];
  others: DraftAttachmentMeta[];
} {
  const images = attachments.filter((a) => a.kind === "image");
  const others = attachments.filter((a) => a.kind !== "image");
  return { images, others };
}

/**
 * Run the full submission pipeline for one composer submit action.
 *
 * - noop: nothing sendable / cannot submit.
 * - queued: agent running (no force) → enqueue per-agent, clear draft.
 * - submitted: clear draft, optimistically append, send via RPC, confirm.
 * - failed: on throw, rollback optimistic + restore draft + toast.
 */
export async function submitMessage(
  deps: SubmissionDeps,
  input: SubmissionInput,
): Promise<SubmissionOutcome> {
  const now = deps.now?.() ?? Date.now();
  const trimmed = input.text.trim();

  const decision: SubmitDecision = resolveSubmitDecision({
    text: trimmed,
    attachments: input.attachments,
    agentRunning: input.agentRunning,
    forceSubmit: input.forceSubmit,
    canSubmit: input.canSubmit,
  });

  if (decision === "noop" || decision === "failed") {
    return { decision: "noop" };
  }

  if (decision === "queued") {
    const messageId = deps.newId();
    deps.queue.enqueue(input.agentId, {
      id: messageId,
      text: trimmed,
      attachments: input.attachments,
    });
    // Queued messages leave the composer (unless preserve-and-lock, handled by caller).
    deps.drafts.markSent(input.draftKey);
    return { decision: "queued", messageId };
  }

  // decision === "submitted"
  const clientMessageId = deps.newId();
  const sender = deps.getSender(input.agentId);
  if (!sender) {
    // canSubmit said yes but no transport — treat as noop rather than crash.
    return { decision: "noop" };
  }

  // Optimistic append + clear draft immediately.
  deps.optimistic.addOptimisticMessage(input.agentId, {
    clientMessageId,
    text: trimmed,
    timestamp: now,
  });
  deps.drafts.markSent(input.draftKey);

  const resolved = deps.resolveImages ? await deps.resolveImages(input.attachments) : {};
  const payload = buildSendAttachments(input.attachments, resolved);

  try {
    await sender.send(trimmed, { clientMessageId, images: payload.images });
    deps.optimistic.confirmOptimisticMessage(input.agentId, clientMessageId);
    return { decision: "submitted", clientMessageId };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to send message";
    deps.optimistic.rollbackOptimisticMessage(input.agentId, clientMessageId);
    deps.drafts.restore(input.draftKey, trimmed);
    deps.toastError(message);
    return { decision: "failed", clientMessageId, error: message };
  }
}

// ─── Queue flush (auto-send on idle) ──────────────────────────────────────────

export interface FlushOutcome {
  sent: string[];
  /** Message that failed (re-inserted at front) + error, if any. */
  failedAt?: { messageId: string; error: string };
}

/**
 * Flush an agent's queued messages in FIFO order, sending each via RPC.
 * On the first failure, re-insert the failing message at the front of the
 * queue, toast, and stop (remaining messages stay queued).
 */
export async function flushAgentQueue(
  deps: SubmissionDeps,
  agentId: string,
): Promise<FlushOutcome> {
  const sender = deps.getSender(agentId);
  const messages = deps.queue.flush(agentId);
  const sent: string[] = [];

  if (!sender) {
    // No transport — put everything back at the front, preserving order.
    for (let i = messages.length - 1; i >= 0; i--) {
      deps.queue.reinsertAtFront(agentId, messages[i]!);
    }
    return { sent };
  }

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]!;
    const clientMessageId = deps.newId();
    const now = deps.now?.() ?? Date.now();
    deps.optimistic.addOptimisticMessage(agentId, {
      clientMessageId,
      text: msg.text,
      timestamp: now,
    });
    try {
      const resolved = deps.resolveImages ? await deps.resolveImages(msg.attachments) : {};
      const payload = buildSendAttachments(msg.attachments, resolved);
      await sender.send(msg.text, { clientMessageId, images: payload.images });
      deps.optimistic.confirmOptimisticMessage(agentId, clientMessageId);
      sent.push(msg.id);
    } catch (err) {
      const error = err instanceof Error ? err.message : "Failed to send queued message";
      deps.optimistic.rollbackOptimisticMessage(agentId, clientMessageId);
      // Re-insert the failed message and any remaining ones at the front,
      // preserving their original order.
      for (let j = messages.length - 1; j >= i; j--) {
        deps.queue.reinsertAtFront(agentId, messages[j]!);
      }
      deps.toastError(error);
      return { sent, failedAt: { messageId: msg.id, error } };
    }
  }

  return { sent };
}
