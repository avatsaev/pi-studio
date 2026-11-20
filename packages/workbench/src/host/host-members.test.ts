import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installHost, resetHostForTests } from "./install.js";
import { routeExternalLinkClick } from "./external-link.js";
import {
  applySessionRename,
  deleteWorkspaceConversations,
} from "../features/sessions/session-actions.js";
import { useSessionStore } from "../stores/session-store.js";
import { resetSessionStore, resetTabStore } from "../test/reset-stores.js";
import { createTestDaemons } from "../test/test-daemons.js";
import { createTestHost } from "../test/test-host.js";

function fakeClient() {
  const update = vi.fn(async () => {});
  const del = vi.fn(async () => {});
  return { client: { agent: vi.fn(() => ({ update, delete: del })) }, update, del };
}

function seedSession(title = "Old title"): string {
  const id = useSessionStore.getState().createSession("/work");
  useSessionStore.getState().bindAgent(id, `agent-${id}`);
  useSessionStore.getState().setTitle(id, title);
  return id;
}

beforeEach(() => {
  resetHostForTests();
  resetSessionStore();
  resetTabStore();
});

afterEach(() => vi.restoreAllMocks());

describe("dialogs through the host", () => {
  it("renames locally and on the daemon", () => {
    const id = seedSession();
    const { client, update } = fakeClient();

    applySessionRename(useSessionStore.getState().sessions[id]!, "New title", client as never);

    expect(useSessionStore.getState().sessions[id]!.title).toBe("New title");
    expect(update).toHaveBeenCalledWith({ title: "New title" });
  });

  it("deletes nothing when the confirm resolves false", async () => {
    const host = createTestHost({ confirms: [false] });
    installHost(host);
    const id = seedSession();
    const { client, del } = fakeClient();
    const onConfirmed = vi.fn();

    const confirmed = await deleteWorkspaceConversations(
      "/work",
      [useSessionStore.getState().sessions[id]!],
      client as never,
      onConfirmed,
    );

    expect(confirmed).toBe(false);
    expect(onConfirmed).not.toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();
    expect(useSessionStore.getState().sessions[id]).toBeDefined();
    expect(host.calls[0]?.member).toBe("dialogs.confirm");
  });

  it("deletes every conversation once confirmed", async () => {
    installHost(createTestHost({ confirms: [true] }));
    const id = seedSession();
    const { client, del } = fakeClient();

    await deleteWorkspaceConversations(
      "/work",
      [useSessionStore.getState().sessions[id]!],
      client as never,
      () => {},
    );

    expect(del).toHaveBeenCalledTimes(1);
    expect(useSessionStore.getState().sessions[id]).toBeUndefined();
  });
});

describe("external links through the host", () => {
  it("hands the URL to openExternal and suppresses the navigation", () => {
    const host = createTestHost({ openExternal: true });
    installHost(host);
    const preventDefault = vi.fn();

    routeExternalLinkClick({ preventDefault }, "https://example.com/login");

    expect(preventDefault).toHaveBeenCalled();
    expect(host.calls).toEqual([
      { member: "links.openExternal", args: ["https://example.com/login"] },
    ]);
  });

  it("leaves the native navigation alone without openExternal", () => {
    installHost(createTestHost());
    const preventDefault = vi.fn();

    routeExternalLinkClick({ preventDefault }, "https://example.com/login");

    expect(preventDefault).not.toHaveBeenCalled();
  });
});

describe("preview through the host", () => {
  it("is absent unless the test host is given one", () => {
    expect(createTestHost().preview).toBeUndefined();
    expect(createTestHost({ preview: "inert" }).preview).toEqual({ kind: "inert" });
  });

  it("mounts a document and records its release", async () => {
    const host = createTestHost({ preview: "origin" });
    if (host.preview?.kind !== "origin") throw new Error("expected an origin preview");
    const doc = await host.preview.mount("<p>hi</p>");
    doc.release();
    expect(host.calls).toEqual([
      { member: "preview.mount", args: ["<p>hi</p>"] },
      { member: "preview.release", args: [doc.url] },
    ]);
  });

  it("rejects the mount when told to fail", async () => {
    const host = createTestHost({ preview: { mountFails: "no origin" } });
    if (host.preview?.kind !== "origin") throw new Error("expected an origin preview");
    await expect(host.preview.mount("x")).rejects.toThrow("no origin");
  });
});

describe("daemons through the host", () => {
  it("is absent unless the test host is given a registry", () => {
    const host = createTestHost();
    expect(host.daemons).toBeUndefined();
    expect(host.app.minDaemonVersion).toBeUndefined();
  });

  it("carries the registry and the minimum daemon version when given", () => {
    const daemons = createTestDaemons();
    const host = createTestHost({ daemons, minDaemonVersion: "0.0.119" });
    expect(host.daemons).toBe(daemons);
    expect(host.app.minDaemonVersion).toBe("0.0.119");
  });
});
