import { describe, expect, it, vi } from "vitest";

import { ProviderSnapshotManager, type ProviderSnapshotData } from "./provider-snapshot.js";

const READY: ProviderSnapshotData = {
  available: true,
  models: [{ id: "m" }],
  modes: [{ id: "default" }],
};

function manager(probe = vi.fn(() => Promise.resolve(READY))): {
  mgr: ProviderSnapshotManager;
  probe: typeof probe;
} {
  const mgr = new ProviderSnapshotManager({ homeDir: "/home/user", probe });
  return { mgr, probe };
}

describe("cold → warm caching", () => {
  it("probes once when cold and stays cached until an explicit refresh", async () => {
    const { mgr, probe } = manager();
    const first = await mgr.get("/work");
    expect(first.status).toBe("ready");
    await mgr.get("/work");
    await mgr.get("/work");
    expect(probe).toHaveBeenCalledTimes(1); // warm cache → no re-probe

    await mgr.get("/work", { force: true });
    expect(probe).toHaveBeenCalledTimes(2); // explicit refresh re-probes
  });

  it("shares a single probe across concurrent cold reads", async () => {
    const { mgr, probe } = manager();
    await Promise.all([mgr.get("/work"), mgr.get("/work"), mgr.get("/work")]);
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it("marks unavailable when not available and error when the probe throws", async () => {
    const probe = vi
      .fn<(cwd: string) => Promise<ProviderSnapshotData>>()
      .mockResolvedValueOnce({ available: false, models: [], modes: [] })
      .mockRejectedValueOnce(new Error("spawn failed"));
    const { mgr } = manager(probe);
    expect((await mgr.get("/a")).status).toBe("unavailable");
    expect((await mgr.get("/b")).status).toBe("error");
  });
});

describe("settings refresh", () => {
  it("clears all scopes and re-probes only the home snapshot (force) — workspaces re-probe lazily", async () => {
    const probed: string[] = [];
    const probe = vi.fn((cwd: string) => {
      probed.push(cwd);
      return Promise.resolve(READY);
    });
    const { mgr } = manager(probe);

    await mgr.get("/work"); // warm a workspace
    await mgr.get(); // warm home (blank → /home/user)
    expect(probed).toEqual(["/work", "/home/user"]);

    probed.length = 0;
    await mgr.refreshSettings();
    expect(probed).toEqual(["/home/user"]); // only home re-probed

    // Workspace cache was cleared → next get re-probes it lazily.
    expect(mgr.peek("/work")).toBeUndefined();
    await mgr.get("/work");
    expect(probed).toEqual(["/home/user", "/work"]);
  });
});
