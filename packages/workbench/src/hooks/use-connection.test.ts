import { describe, expect, it, vi } from "vitest";
import { createTestDaemons } from "../test/test-daemons.js";
import { createTestHost } from "../test/test-host.js";
import { bootConnection } from "./use-connection.js";

function deps() {
  const state = { host: "ws://127.0.0.1:6767", password: "", cwd: "" };
  const connect = vi.fn();
  const connectCurrent = vi.fn();
  return {
    state,
    connect,
    connectCurrent,
    deps: {
      setHost: (v: string) => void (state.host = v),
      setPassword: (v: string) => void (state.password = v),
      setCwd: (v: string) => void (state.cwd = v),
      fields: () => state,
      connect,
      connectCurrent,
    },
  };
}

describe("bootConnection", () => {
  it("asks the registry once and leaves the launch intent and the fields alone", () => {
    const host = createTestHost({
      daemons: createTestDaemons(),
      connectIntent: { url: "other:1", password: "pw", connect: true },
    });
    const d = deps();

    bootConnection(host, d.deps);

    expect(d.connectCurrent).toHaveBeenCalledTimes(1);
    expect(d.connect).not.toHaveBeenCalled();
    expect(d.state).toEqual({ host: "ws://127.0.0.1:6767", password: "", cwd: "" });
    expect(host.calls.some((c) => c.member === "launch.initialConnect")).toBe(false);
  });

  it("applies the launch intent when the host has no registry", () => {
    const host = createTestHost({
      connectIntent: { url: "box:6767", password: "pw", connect: true },
    });
    const d = deps();

    bootConnection(host, d.deps);

    expect(d.connectCurrent).not.toHaveBeenCalled();
    expect(d.connect).toHaveBeenCalledWith({ url: "box:6767", password: "pw" });
    expect(d.state.host).toBe("box:6767");
  });

  it("does nothing for a registry-less host with no intent", () => {
    const d = deps();
    bootConnection(createTestHost({ connectIntent: null }), d.deps);
    expect(d.connect).not.toHaveBeenCalled();
    expect(d.connectCurrent).not.toHaveBeenCalled();
  });
});
