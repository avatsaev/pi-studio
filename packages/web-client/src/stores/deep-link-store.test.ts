import { describe, expect, it } from "vitest";
import { useDeepLinkStore } from "./deep-link-store.js";

describe("deep-link store", () => {
  it("consume returns the pending id once", () => {
    useDeepLinkStore.getState().set("abc");
    expect(useDeepLinkStore.getState().consume()).toBe("abc");
    expect(useDeepLinkStore.getState().consume()).toBeUndefined();
  });
});
