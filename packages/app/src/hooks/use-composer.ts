/**
 * Composer React hooks — draft persistence + submission pipeline.
 *
 * `useDraft(draftKey)` loads/saves the composer draft (text + attachments) to
 * the KV store, debounced 300ms, surviving refresh / tab switch / restart.
 *
 * `useComposerController(...)` wires the framework-agnostic submission
 * pipeline (`orchestrator.ts`) to the live client, session store, draft
 * store, per-agent queue store, and toast, and auto-flushes queued messages
 * when the agent transitions to idle.
 *
 * clean-room-scope/features/composer-ui.md § Data & Persistence, § Sendable
 *   content & the submit decision, § Queue (agent running)
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DraftStore, type ComposerDraft, type DraftAttachmentMeta } from "../composer/draft-store.js";
import { useComposerQueueStore } from "../composer/queue-store.js";
import {
  createIndexedDbAttachmentStore,
  type AttachmentBytesStore,
  type StoredImage,
} from "../composer/attachments.js";
import type { DraftAttachmentMeta as AttachMeta } from "../composer/draft-store.js";
import {
  submitMessage,
  flushAgentQueue,
  type SubmissionDeps,
  type SubmissionOutcome,
} from "../composer/orchestrator.js";
import type { ComposerProcessingState } from "../composer/submit.js";
import { useSessionStore } from "../store/session-store.js";
import { useClient } from "./client-context.js";
import { useToast } from "../components/overlays/ToastContext.js";
import { createWebKVStore, type KeyValueStore } from "../providers/kv-store.js";
import type { LayoutStorage } from "../workspace/layout-store.js";
import { randomUUID } from "../util/uuid.js";
import type { AgentStatus } from "@av-pi-studio/protocol";

export const DRAFT_AUTOSAVE_DEBOUNCE_MS = 300;

// Shared KV instance (stateless wrapper around localStorage).
const kvStore = createWebKVStore();

/** Adapt a KeyValueStore to the LayoutStorage shape DraftStore expects. */
export function kvToLayoutStorage(kv: KeyValueStore): LayoutStorage {
  return {
    getItem: (key) => kv.get(key),
    setItem: (key, value) => kv.set(key, value),
  };
}

const sharedDraftStore = new DraftStore(kvToLayoutStorage(kvStore));

/** Shared image-bytes store (IndexedDB in browser, memory fallback elsewhere). */
export const sharedAttachmentStore: AttachmentBytesStore = createIndexedDbAttachmentStore();

async function resolveImageBytes(
  store: AttachmentBytesStore,
  attachments: AttachMeta[],
): Promise<Record<string, StoredImage>> {
  const out: Record<string, StoredImage> = {};
  for (const att of attachments) {
    if (att.kind === "image") {
      const bytes = await store.get(att.storageKey);
      if (bytes) out[att.storageKey] = bytes;
    }
  }
  return out;
}

// ─── useDraft ─────────────────────────────────────────────────────────────────

export interface UseDraftResult {
  text: string;
  attachments: DraftAttachmentMeta[];
  setText(text: string): void;
  addAttachment(att: DraftAttachmentMeta): void;
  removeAttachment(index: number): void;
  /** Replace the full attachment set (persisted). */
  setAttachments(attachments: DraftAttachmentMeta[]): void;
  /** Clear the draft (lifecycle → sent) — call after a successful submit. */
  clear(): void;
  /** Restore text after a failed send. */
  restore(text: string): void;
}

/**
 * Draft state for one draft key, persisted to KV (debounced). Rehydrates on
 * key change so switching workspaces/agents restores the right draft.
 */
export function useDraft(draftKey: string, store: DraftStore = sharedDraftStore): UseDraftResult {
  const [draft, setDraft] = useState<ComposerDraft>(() => store.load(draftKey));
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<ComposerDraft | null>(null);

  // Rehydrate when the key changes.
  useEffect(() => {
    setDraft(store.load(draftKey));
  }, [draftKey, store]);

  // Flush any pending save on unmount / key change.
  useEffect(() => {
    return () => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        saveTimer.current = null;
      }
      if (pending.current) {
        store.save(pending.current);
        pending.current = null;
      }
    };
  }, [draftKey, store]);

  const scheduleSave = useCallback(
    (next: ComposerDraft) => {
      pending.current = next;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        if (pending.current) {
          store.save(pending.current);
          pending.current = null;
        }
        saveTimer.current = null;
      }, DRAFT_AUTOSAVE_DEBOUNCE_MS);
    },
    [store],
  );

  const setText = useCallback(
    (text: string) => {
      setDraft((d) => {
        const next = { ...d, text, key: draftKey };
        scheduleSave(next);
        return next;
      });
    },
    [draftKey, scheduleSave],
  );

  const addAttachment = useCallback(
    (att: DraftAttachmentMeta) => {
      setDraft((d) => {
        const next = { ...d, key: draftKey, attachments: [...d.attachments, att] };
        scheduleSave(next);
        return next;
      });
    },
    [draftKey, scheduleSave],
  );

  const removeAttachment = useCallback(
    (index: number) => {
      setDraft((d) => {
        const next = { ...d, key: draftKey, attachments: d.attachments.filter((_, i) => i !== index) };
        scheduleSave(next);
        return next;
      });
    },
    [draftKey, scheduleSave],
  );

  const setAttachments = useCallback(
    (next: DraftAttachmentMeta[]) => {
      setDraft((d) => {
        const updated = { ...d, key: draftKey, attachments: next };
        scheduleSave(updated);
        return updated;
      });
    },
    [draftKey, scheduleSave],
  );

  const clear = useCallback(() => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    pending.current = null;
    store.markSent(draftKey);
    setDraft({ key: draftKey, text: "", attachments: [], lifecycle: "sent" });
  }, [draftKey, store]);

  const restore = useCallback(
    (text: string) => {
      const restored = store.restore(draftKey, text);
      setDraft(restored);
    },
    [draftKey, store],
  );

  return {
    text: draft.text,
    attachments: draft.attachments,
    setText,
    addAttachment,
    removeAttachment,
    setAttachments,
    clear,
    restore,
  };
}

// ─── useComposerController ────────────────────────────────────────────────────

export interface UseComposerControllerOptions {
  agentId: string | undefined;
  draftKey: string;
  /** Optional caller-managed submit (create-agent / new-workspace flows). */
  onSubmitMessage?: (text: string, attachments: DraftAttachmentMeta[]) => void;
}

export interface ComposerController {
  agentRunning: boolean;
  processingState: ComposerProcessingState;
  submit(text: string, attachments: DraftAttachmentMeta[], forceSubmit?: boolean): Promise<SubmissionOutcome>;
}

const RUNNING_STATUSES: ReadonlySet<AgentStatus> = new Set<AgentStatus>([
  "initializing",
  "running",
] as AgentStatus[]);

/** Build orchestrator deps from live app singletons + injected client. */
function useSubmissionDeps(): SubmissionDeps {
  const client = useClient();
  const toast = useToast();

  return useMemo<SubmissionDeps>(() => {
    const session = useSessionStore.getState();
    const queue = useComposerQueueStore.getState();
    return {
      getSender: (agentId) => (client ? client.agent(agentId) : undefined),
      optimistic: {
        addOptimisticMessage: session.addOptimisticMessage,
        confirmOptimisticMessage: session.confirmOptimisticMessage,
        rollbackOptimisticMessage: session.rollbackOptimisticMessage,
      },
      drafts: {
        markSent: (key) => sharedDraftStore.markSent(key),
        restore: (key, text) => sharedDraftStore.restore(key, text),
      },
      queue: {
        enqueue: queue.enqueue,
        reinsertAtFront: queue.reinsertAtFront,
        flush: queue.flush,
      },
      toastError: (message) => toast.error(message),
      newId: () => randomUUID(),
      resolveImages: (attachments) => resolveImageBytes(sharedAttachmentStore, attachments),
    };
  }, [client, toast]);
}

export function useComposerController(options: UseComposerControllerOptions): ComposerController {
  const { agentId, draftKey } = options;
  const deps = useSubmissionDeps();
  const [processingState, setProcessingState] = useState<ComposerProcessingState>("idle");

  const status = useSessionStore((s) => (agentId ? s.agents[agentId]?.status : undefined));
  const agentRunning = status !== undefined && RUNNING_STATUSES.has(status);
  const canSubmit = !!agentId;

  // Auto-flush queued messages when the agent transitions to idle.
  const prevRunning = useRef(agentRunning);
  useEffect(() => {
    if (!agentId) return;
    const wasRunning = prevRunning.current;
    prevRunning.current = agentRunning;
    if (wasRunning && !agentRunning) {
      void flushAgentQueue(deps, agentId);
    }
  }, [agentId, agentRunning, deps]);

  const submit = useCallback(
    async (text: string, attachments: DraftAttachmentMeta[], forceSubmit = false): Promise<SubmissionOutcome> => {
      if (!agentId) {
        // Caller-managed flow (draft / create-agent) — delegate.
        options.onSubmitMessage?.(text, attachments);
        return { decision: "noop" };
      }
      setProcessingState("processing");
      try {
        return await submitMessage(deps, {
          agentId,
          draftKey,
          text,
          attachments,
          agentRunning,
          forceSubmit,
          canSubmit,
        });
      } finally {
        setProcessingState("idle");
      }
    },
    [agentId, draftKey, deps, agentRunning, canSubmit, options],
  );

  return { agentRunning, processingState, submit };
}
