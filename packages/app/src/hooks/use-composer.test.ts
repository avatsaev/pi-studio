import { describe, it, expect } from "vitest";
import { kvToLayoutStorage } from "./use-composer.js";
import { createMemoryKVStore } from "../providers/kv-store.js";
import { DraftStore } from "../composer/draft-store.js";

// The React hook itself (useDraft) is exercised in the app; here we verify the
// persistence substrate it relies on: draft text/attachments round-trip through
// the KV store and survive a simulated page refresh (fresh DraftStore over the
// same KV backing).

describe("kvToLayoutStorage + DraftStore persistence", () => {
  it("persists draft text to KV and restores it after refresh", () => {
    const kv = createMemoryKVStore();
    const storage = kvToLayoutStorage(kv);

    // Session 1: type into the composer.
    const store1 = new DraftStore(storage);
    store1.setText("agent:a1", "unsent thoughts");
    expect(store1.load("agent:a1").text).toBe("unsent thoughts");

    // Session 2: simulate a page refresh — brand new store over same KV.
    const store2 = new DraftStore(kvToLayoutStorage(kv));
    expect(store2.load("agent:a1").text).toBe("unsent thoughts");
  });

  it("persists attachments and clears the draft on markSent", () => {
    const kv = createMemoryKVStore();
    const store = new DraftStore(kvToLayoutStorage(kv));
    store.addAttachment("agent:a1", { kind: "image", storageKey: "k1", mimeType: "image/png", name: "a.png" });
    expect(store.load("agent:a1").attachments).toHaveLength(1);

    store.markSent("agent:a1");
    const after = new DraftStore(kvToLayoutStorage(kv)).load("agent:a1");
    expect(after.text).toBe("");
    expect(after.attachments).toHaveLength(0);
    expect(after.lifecycle).toBe("sent");
  });

  it("restore brings text back and marks the draft active again", () => {
    const kv = createMemoryKVStore();
    const store = new DraftStore(kvToLayoutStorage(kv));
    store.setText("agent:a1", "draft");
    store.markSent("agent:a1");
    store.restore("agent:a1", "recovered after send failure");
    const reloaded = new DraftStore(kvToLayoutStorage(kv)).load("agent:a1");
    expect(reloaded.text).toBe("recovered after send failure");
    expect(reloaded.lifecycle).toBe("active");
  });
});
