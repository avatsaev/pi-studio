import { describe, expect, it, vi } from "vitest";

import { type BootSnapshot } from "./boot.js";
import { createDesktopHost } from "./desktop-host.js";
import { type Ipc, type IpcEvents } from "./ipc.js";

const snapshotWith = (transfers: "engine" | "page", kind: "local" | "direct" | "relay"): BootSnapshot =>
  ({
    app: { title: "Pi Studio", version: "1.0.0", platform: "desktop", minDaemonVersion: "1.0.0" },
    storage: {},
    notices: [],
    preview: "inert",
    transfers,
    daemons: {
      currentId: "e1",
      entries: [{ id: "e1", kind, name: "n", hasPassword: false }],
      local: { state: "stopped" },
      settings: { autoStartLocalDaemon: false },
    },
  }) as unknown as BootSnapshot;

const build = (snapshot: BootSnapshot) => {
  const invoke = vi.fn<Ipc["invoke"]>(async () => null);
  const listen = vi.fn<IpcEvents["listen"]>(async () => () => undefined);
  const host = createDesktopHost(
    snapshot,
    { invoke, listen },
    { workerSrc: "w", assetsUrl: "/a/" } as never,
    () => undefined,
  );
  return { host, invoke, listen };
};

describe("desktop host files", () => {
  it.each([
    ["page", "local"],
    ["page", "direct"],
  ] as const)(
    "transfers %s, entry %s: no pickUploads, no engine command, no progress listener",
    async (transfers, kind) => {
      const { host, invoke, listen } = build(snapshotWith(transfers, kind));
      expect("pickUploads" in host.files).toBe(false);
      expect(listen.mock.calls.filter(([event]) => event === "transfer_progress")).toHaveLength(0);
      await Promise.resolve();
      expect(
        invoke.mock.calls.filter(
          ([command]) => /^(upload_pick|transfer_)/.test(command) && command !== "transfers_set",
        ),
      ).toHaveLength(0);
    },
  );

  it.each(["local", "direct", "relay"] as const)("transfers engine, entry %s: pickUploads is present", (kind) => {
    const { host, listen } = build(snapshotWith("engine", kind));
    expect("pickUploads" in host.files).toBe(true);
    expect(listen.mock.calls.filter(([event]) => event === "transfer_progress")).toHaveLength(1);
  });
});
