import { describe, it, expect, beforeEach } from "vitest";
import {
  submitMessage,
  flushAgentQueue,
  splitAttachments,
  type SubmissionDeps,
} from "./orchestrator.js";
import { useComposerQueueStore } from "./queue-store.js";
import { DraftStore, type DraftAttachmentMeta } from "./draft-store.js";
import { createMemoryLayoutStorage } from "../workspace/layout-store.js";

// ─── Test harness ─────────────────────────────────────────────────────────────

type OptEvent = { kind: "add" | "confirm" | "rollback"; agentId: string; id: string; text?: string };

function makeHarness(opts: {
  sendImpl?: (prompt: string) => Promise<unknown>;
} = {}) {
  const optimisticEvents: OptEvent[] = [];
  const toasts: string[] = [];
  const layout = createMemoryLayoutStorage();
  const draftStore = new DraftStore(layout);
  const sendCalls: { prompt: string; images?: unknown[] }[] = [];
  let idCounter = 0;

  const sendImpl =
    opts.sendImpl ??
    (async () => {
      /* resolves ok */
    });

  const deps: SubmissionDeps = {
    getSender: () => ({
      send: async (prompt, sendOpts) => {
        sendCalls.push({ prompt, images: sendOpts?.images });
        return sendImpl(prompt);
      },
    }),
    optimistic: {
      addOptimisticMessage: (agentId, msg) =>
        optimisticEvents.push({ kind: "add", agentId, id: msg.clientMessageId, text: msg.text }),
      confirmOptimisticMessage: (agentId, id) => optimisticEvents.push({ kind: "confirm", agentId, id }),
      rollbackOptimisticMessage: (agentId, id) => optimisticEvents.push({ kind: "rollback", agentId, id }),
    },
    drafts: {
      markSent: (key) => draftStore.markSent(key),
      restore: (key, text) => draftStore.restore(key, text),
    },
    queue: {
      enqueue: (agentId, m) => useComposerQueueStore.getState().enqueue(agentId, m),
      reinsertAtFront: (agentId, m) => useComposerQueueStore.getState().reinsertAtFront(agentId, m),
      flush: (agentId) => useComposerQueueStore.getState().flush(agentId),
    },
    toastError: (m) => toasts.push(m),
    newId: () => `id-${++idCounter}`,
    now: () => 1000,
  };

  return { deps, optimisticEvents, toasts, draftStore, sendCalls };
}

beforeEach(() => {
  useComposerQueueStore.setState({ queues: {} });
});

// ─── splitAttachments ─────────────────────────────────────────────────────────

describe("splitAttachments", () => {
  it("separates image attachments from metadata-only ones", () => {
    const atts: DraftAttachmentMeta[] = [
      { kind: "image", storageKey: "k1", mimeType: "image/png", name: "a.png" },
      { kind: "github_pr", number: 5, title: "Fix", url: "u" },
      { kind: "image", storageKey: "k2", mimeType: "image/jpeg", name: "b.jpg" },
    ];
    const { images, others } = splitAttachments(atts);
    expect(images).toHaveLength(2);
    expect(others).toHaveLength(1);
    expect(others[0]!.kind).toBe("github_pr");
  });
});

// ─── submitMessage ──────────────────────────────────────────────────────────

describe("submitMessage", () => {
  it("noop when nothing sendable", async () => {
    const h = makeHarness();
    const out = await submitMessage(h.deps, {
      agentId: "a1", draftKey: "agent:a1", text: "   ", attachments: [],
      agentRunning: false, forceSubmit: false, canSubmit: true,
    });
    expect(out.decision).toBe("noop");
    expect(h.sendCalls).toHaveLength(0);
  });

  it("submits: optimistic append, send RPC, confirm, draft cleared", async () => {
    const h = makeHarness();
    h.draftStore.setText("agent:a1", "hello world");
    const out = await submitMessage(h.deps, {
      agentId: "a1", draftKey: "agent:a1", text: "hello world", attachments: [],
      agentRunning: false, forceSubmit: false, canSubmit: true,
    });
    expect(out.decision).toBe("submitted");
    expect(h.sendCalls).toEqual([{ prompt: "hello world", images: [] }]);
    // optimistic add then confirm
    expect(h.optimisticEvents.map((e) => e.kind)).toEqual(["add", "confirm"]);
    // draft cleared (lifecycle sent, empty text)
    expect(h.draftStore.load("agent:a1").text).toBe("");
    expect(h.draftStore.load("agent:a1").lifecycle).toBe("sent");
  });

  it("queues when agent running (no force): enqueue + clear draft, no send", async () => {
    const h = makeHarness();
    h.draftStore.setText("agent:a1", "queued msg");
    const out = await submitMessage(h.deps, {
      agentId: "a1", draftKey: "agent:a1", text: "queued msg", attachments: [],
      agentRunning: true, forceSubmit: false, canSubmit: true,
    });
    expect(out.decision).toBe("queued");
    expect(h.sendCalls).toHaveLength(0);
    expect(useComposerQueueStore.getState().peek("a1")).toHaveLength(1);
    expect(h.draftStore.load("agent:a1").text).toBe("");
  });

  it("force-submits even while running", async () => {
    const h = makeHarness();
    const out = await submitMessage(h.deps, {
      agentId: "a1", draftKey: "agent:a1", text: "urgent", attachments: [],
      agentRunning: true, forceSubmit: true, canSubmit: true,
    });
    expect(out.decision).toBe("submitted");
    expect(h.sendCalls).toHaveLength(1);
  });

  it("failed send: rollback optimistic, restore draft, toast", async () => {
    const h = makeHarness({ sendImpl: async () => { throw new Error("network down"); } });
    h.draftStore.setText("agent:a1", "will fail");
    const out = await submitMessage(h.deps, {
      agentId: "a1", draftKey: "agent:a1", text: "will fail", attachments: [],
      agentRunning: false, forceSubmit: false, canSubmit: true,
    });
    expect(out.decision).toBe("failed");
    expect(h.optimisticEvents.map((e) => e.kind)).toEqual(["add", "rollback"]);
    // draft restored (active + text back)
    expect(h.draftStore.load("agent:a1").text).toBe("will fail");
    expect(h.draftStore.load("agent:a1").lifecycle).toBe("active");
    expect(h.toasts).toEqual(["network down"]);
  });

  it("noop when canSubmit=false", async () => {
    const h = makeHarness();
    const out = await submitMessage(h.deps, {
      agentId: "a1", draftKey: "agent:a1", text: "hi", attachments: [],
      agentRunning: false, forceSubmit: false, canSubmit: false,
    });
    expect(out.decision).toBe("noop");
    expect(h.sendCalls).toHaveLength(0);
  });
});

// ─── flushAgentQueue ──────────────────────────────────────────────────────────

describe("flushAgentQueue", () => {
  it("sends all queued messages FIFO and empties the queue", async () => {
    const h = makeHarness();
    const q = useComposerQueueStore.getState();
    q.enqueue("a1", { id: "m1", text: "first", attachments: [] });
    q.enqueue("a1", { id: "m2", text: "second", attachments: [] });

    const out = await flushAgentQueue(h.deps, "a1");
    expect(out.sent).toEqual(["m1", "m2"]);
    expect(h.sendCalls.map((c) => c.prompt)).toEqual(["first", "second"]);
    expect(useComposerQueueStore.getState().peek("a1")).toHaveLength(0);
  });

  it("on failure reinserts failed + remaining at front, in order, and stops", async () => {
    let n = 0;
    const h = makeHarness({
      sendImpl: async () => {
        n++;
        if (n === 2) throw new Error("boom");
      },
    });
    const q = useComposerQueueStore.getState();
    q.enqueue("a1", { id: "m1", text: "first", attachments: [] });
    q.enqueue("a1", { id: "m2", text: "second", attachments: [] });
    q.enqueue("a1", { id: "m3", text: "third", attachments: [] });

    const out = await flushAgentQueue(h.deps, "a1");
    expect(out.sent).toEqual(["m1"]);
    expect(out.failedAt?.messageId).toBe("m2");
    // m2 and m3 remain, m2 at front, original order preserved
    expect(useComposerQueueStore.getState().peek("a1").map((m) => m.id)).toEqual(["m2", "m3"]);
    expect(h.toasts).toEqual(["boom"]);
  });
});
