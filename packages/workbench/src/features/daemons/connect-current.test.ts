import { describe, expect, it, vi } from "vitest";
import { type ConnectIntent } from "../../host/types.js";
import { connectCurrent } from "./connect-current.js";

function setup(resolve: () => Promise<ConnectIntent>) {
  const deps = { connect: vi.fn(), resolved: vi.fn(), rejected: vi.fn() };
  return { deps, run: () => connectCurrent({ resolveCurrent: resolve }, deps) };
}

describe("connectCurrent", () => {
  it("connects with the intent's address and password", async () => {
    const { deps, run } = setup(async () => ({ url: "box:6767", password: "pw", connect: true }));
    await run();
    expect(deps.connect).toHaveBeenCalledTimes(1);
    expect(deps.connect).toHaveBeenCalledWith({ url: "box:6767", password: "pw" });
    expect(deps.resolved).toHaveBeenCalledTimes(1);
    expect(deps.rejected).not.toHaveBeenCalled();
  });

  it("connects without a password when the entry has none", async () => {
    const { deps, run } = setup(async () => ({ url: "box:6767", connect: true }));
    await run();
    expect(deps.connect).toHaveBeenCalledWith({ url: "box:6767", password: undefined });
  });

  it("sends no password with a pairing link", async () => {
    const offer = encodeURIComponent(btoa(String.fromCharCode(...new Uint8Array(32).fill(1))));
    const url = `https://app.local/#offer=${offer}&host=box:6767`;
    const { deps, run } = setup(async () => ({ url, password: "pw", connect: true }));
    await run();
    expect(deps.connect).toHaveBeenCalledWith({ url, password: undefined });
  });

  it("reports the code of a refusal and dials nothing", async () => {
    const { deps, run } = setup(() =>
      Promise.reject(Object.assign(new Error("outdated"), { code: "outdated" })),
    );
    await run();
    expect(deps.rejected).toHaveBeenCalledWith("outdated");
    expect(deps.connect).not.toHaveBeenCalled();
    expect(deps.resolved).not.toHaveBeenCalled();
  });

  it("reports a rejection that is not a DaemonError as unexpected", async () => {
    const { deps, run } = setup(() => Promise.reject(new Error("boom")));
    await run();
    expect(deps.rejected).toHaveBeenCalledWith("unexpected");
  });

  it("does not connect for an intent that does not ask to or has no address", async () => {
    const a = setup(async () => ({ url: "box:6767", connect: false }));
    await a.run();
    expect(a.deps.connect).not.toHaveBeenCalled();
    const b = setup(async () => ({ connect: true }));
    await b.run();
    expect(b.deps.connect).not.toHaveBeenCalled();
  });
});
