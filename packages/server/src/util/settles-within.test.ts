import { afterEach, describe, expect, it, vi } from "vitest";

import { settlesWithin } from "./settles-within.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("settlesWithin", () => {
  it("is true once the promise resolves, and leaves no timer behind", async () => {
    vi.useFakeTimers();
    const { promise, resolve } = Promise.withResolvers<void>();
    const result = settlesWithin(promise, 1000);

    resolve();

    expect(await result).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("is true when the promise rejects: it settled, which is what the caller waits for", async () => {
    const { promise, reject } = Promise.withResolvers<void>();
    const result = settlesWithin(promise, 1000);

    reject(new Error("exited with an error"));

    expect(await result).toBe(true);
  });

  it("is false when the time runs out first", async () => {
    vi.useFakeTimers();
    const result = settlesWithin(Promise.withResolvers<void>().promise, 1000);

    await vi.advanceTimersByTimeAsync(999);
    await vi.advanceTimersByTimeAsync(1);

    expect(await result).toBe(false);
  });
});
