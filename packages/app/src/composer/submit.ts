// Submit decision, create-vs-continue routing, optimistic bubble.
// clean-room-scope/features/composer-ui.md § Sendable content, § Create vs continue, § Submit decision

import type { DraftAttachmentMeta } from "./draft-store.js";

export type SubmitDecision = "noop" | "queued" | "submitted" | "failed";
export type SubmitBehavior = "clear" | "preserve-and-lock";

export type SubmitInput = {
  text: string;
  attachments: DraftAttachmentMeta[];
  agentRunning: boolean;
  forceSubmit: boolean;
  canSubmit: boolean;
  submitBehavior?: SubmitBehavior;
};

export function resolveSubmitDecision(input: SubmitInput): SubmitDecision {
  const hasSendable = input.text.trim().length > 0 || input.attachments.length > 0;
  if (!hasSendable || !input.canSubmit) return "noop";
  if (input.agentRunning && !input.forceSubmit) return "queued";
  return "submitted";
}

export type OptimisticMessage = {
  id: string;
  text: string;
  attachments: DraftAttachmentMeta[];
  timestamp: number;
  optimistic: true;
};

export function buildOptimisticMessage(text: string, attachments: DraftAttachmentMeta[], id: string, now = Date.now()): OptimisticMessage {
  return { id, text, attachments, timestamp: now, optimistic: true };
}

export type CreateOrContinue = "create" | "continue";

export function resolveCreateOrContinue(input: { hasCaller: boolean; agentId: string | undefined }): CreateOrContinue {
  if (input.hasCaller) return "create";
  return input.agentId ? "continue" : "create";
}

export type SendError = { message: string; recoverable: boolean };

export type ComposerProcessingState = "idle" | "processing" | "locked";

export type ComposerState = {
  processing: ComposerProcessingState;
  sendError?: SendError;
  pendingOptimistic?: OptimisticMessage;
};

export const INITIAL_COMPOSER_STATE: ComposerState = { processing: "idle" };

export function startProcessing(state: ComposerState, optimistic: OptimisticMessage): ComposerState {
  return { ...state, processing: "processing", sendError: undefined, pendingOptimistic: optimistic };
}

export function clearOnSent(state: ComposerState): ComposerState {
  return { processing: "idle", pendingOptimistic: undefined };
}

export function failSend(state: ComposerState, message: string): ComposerState {
  return { ...state, processing: "idle", sendError: { message, recoverable: true }, pendingOptimistic: undefined };
}

export function clearSendError(state: ComposerState): ComposerState {
  return { ...state, sendError: undefined };
}
