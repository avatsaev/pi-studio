import { describe, expect, it, vi, type Mock } from "vitest";
import { createPreviewMounts, type MountedDocument } from "./preview-mounts.js";

interface SpyDocument extends MountedDocument {
  release: Mock<() => void>;
}

function doc(url: string): SpyDocument {
  return { url, release: vi.fn() };
}

describe("createPreviewMounts", () => {
  it("releases the previous document exactly once when a newer one settles", () => {
    const mounts = createPreviewMounts();
    const a = doc("a");
    const b = doc("b");
    expect(mounts.settle(mounts.begin(), a)).toBe(true);
    expect(a.release).not.toHaveBeenCalled();
    expect(mounts.settle(mounts.begin(), b)).toBe(true);
    expect(a.release).toHaveBeenCalledTimes(1);
    expect(b.release).not.toHaveBeenCalled();
    mounts.dispose();
    mounts.dispose();
    expect(a.release).toHaveBeenCalledTimes(1);
    expect(b.release).toHaveBeenCalledTimes(1);
  });

  it("releases a mount that resolves after it was superseded", () => {
    const mounts = createPreviewMounts();
    const slow = doc("slow");
    const fast = doc("fast");
    const slowToken = mounts.begin();
    const fastToken = mounts.begin();
    expect(mounts.settle(fastToken, fast)).toBe(true);
    expect(mounts.settle(slowToken, slow)).toBe(false);
    expect(slow.release).toHaveBeenCalledTimes(1);
    expect(fast.release).not.toHaveBeenCalled();
  });

  it("releases a mount that resolves after dispose", () => {
    const mounts = createPreviewMounts();
    const late = doc("late");
    const token = mounts.begin();
    mounts.dispose();
    expect(mounts.isCurrent(token)).toBe(false);
    expect(mounts.settle(token, late)).toBe(false);
    expect(late.release).toHaveBeenCalledTimes(1);
  });

  it("works again after dispose (effect re-run)", () => {
    const mounts = createPreviewMounts();
    mounts.dispose();
    const next = doc("next");
    expect(mounts.settle(mounts.begin(), next)).toBe(true);
    expect(next.release).not.toHaveBeenCalled();
  });
});
