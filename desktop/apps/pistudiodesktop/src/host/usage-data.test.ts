import { describe, expect, it, vi } from "vitest";

import { type Ipc } from "./ipc.js";
import { createDesktopUsageData, parseUsageDataView } from "./usage-data.js";

describe("parseUsageDataView", () => {
  it("rejects a non-record", () => {
    expect(parseUsageDataView("x")).toBeNull();
  });
});

describe("createDesktopUsageData", () => {
  it("writes shareUsageData and recomputes sending", async () => {
    const invoke = vi.fn<Ipc["invoke"]>(async () => null);
    const usage = createDesktopUsageData({ enabled: false, sending: false }, { invoke });
    await usage.setEnabled(true);
    expect(invoke).toHaveBeenCalledWith("engine_command", {
      id: "settings.set",
      params: { key: "shareUsageData", value: true },
    });
    expect(usage.current()).toEqual({ enabled: true, sending: true });
  });

  it("never sends when blocked", async () => {
    const usage = createDesktopUsageData(
      { enabled: false, sending: false, blocked: "ci", id: "a" },
      { invoke: async () => null },
    );
    await usage.setEnabled(true);
    expect(usage.current()).toEqual({ enabled: true, sending: false, blocked: "ci", id: "a" });
    await usage.setEnabled(false);
    expect(usage.current().enabled).toBe(false);
  });

  it("rejects with the command's error and keeps the view", async () => {
    const usage = createDesktopUsageData(
      { enabled: false, sending: false },
      {
        invoke: async () => {
          throw "disk full";
        },
      },
    );
    await expect(usage.setEnabled(true)).rejects.toThrow("disk full");
    expect(usage.current()).toEqual({ enabled: false, sending: false });
  });
});
