import { describe, it, expect, beforeEach } from "vitest";
import { useComposerQueueStore } from "./queue-store.js";

beforeEach(() => {
  useComposerQueueStore.setState({ queues: {} });
});

describe("useComposerQueueStore", () => {
  it("enqueues per-agent and peeks in FIFO order", () => {
    const s = useComposerQueueStore.getState();
    s.enqueue("a1", { id: "m1", text: "one", attachments: [] });
    s.enqueue("a1", { id: "m2", text: "two", attachments: [] });
    s.enqueue("a2", { id: "n1", text: "other", attachments: [] });
    expect(useComposerQueueStore.getState().peek("a1").map((m) => m.id)).toEqual(["m1", "m2"]);
    expect(useComposerQueueStore.getState().peek("a2").map((m) => m.id)).toEqual(["n1"]);
  });

  it("remove returns the removed message and drops it", () => {
    const s = useComposerQueueStore.getState();
    s.enqueue("a1", { id: "m1", text: "one", attachments: [] });
    const removed = useComposerQueueStore.getState().remove("a1", "m1");
    expect(removed?.text).toBe("one");
    expect(useComposerQueueStore.getState().peek("a1")).toHaveLength(0);
  });

  it("edit removes and returns editable text + attachments", () => {
    const s = useComposerQueueStore.getState();
    s.enqueue("a1", { id: "m1", text: "editable", attachments: [] });
    const { text } = useComposerQueueStore.getState().edit("a1", "m1");
    expect(text).toBe("editable");
    expect(useComposerQueueStore.getState().peek("a1")).toHaveLength(0);
  });

  it("reinsertAtFront places message at head", () => {
    const s = useComposerQueueStore.getState();
    s.enqueue("a1", { id: "m1", text: "one", attachments: [] });
    s.reinsertAtFront("a1", { id: "m0", text: "zero", attachments: [] });
    expect(useComposerQueueStore.getState().peek("a1").map((m) => m.id)).toEqual(["m0", "m1"]);
  });

  it("flush empties and returns messages", () => {
    const s = useComposerQueueStore.getState();
    s.enqueue("a1", { id: "m1", text: "one", attachments: [] });
    s.enqueue("a1", { id: "m2", text: "two", attachments: [] });
    const flushed = useComposerQueueStore.getState().flush("a1");
    expect(flushed.map((m) => m.id)).toEqual(["m1", "m2"]);
    expect(useComposerQueueStore.getState().peek("a1")).toHaveLength(0);
  });

  it("clear drops an agent's queue entirely", () => {
    const s = useComposerQueueStore.getState();
    s.enqueue("a1", { id: "m1", text: "one", attachments: [] });
    s.clear("a1");
    expect(useComposerQueueStore.getState().queues["a1"]).toBeUndefined();
  });
});
