import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  viewerSettingsGetResponseSchema,
  viewerSettingsSetResponseSchema,
  viewerSettingsUpdateSchema,
  type ViewerSettingsGetResponse,
  type ViewerSettingsSetResponse,
} from "@av-pi-studio/protocol";
import { describe, expect, it } from "vitest";

import { silentLogger } from "../logging/logger.js";
import { HandlerRegistry, routeTextFrame } from "../ws/router.js";
import type { Session } from "../ws/session.js";
import { registerViewerSettingsHandlers } from "./viewer-settings-rpc.js";

async function tempHome(): Promise<string> {
  return mkdtemp(join(tmpdir(), "pi-studio-viewer-settings-rpc-"));
}

interface FakeSession {
  sent: unknown[];
  send: (env: unknown) => void;
}

function fakeSession(): FakeSession & Session {
  const sent: unknown[] = [];
  return { sent, send: (env: unknown) => sent.push(env) } as unknown as FakeSession & Session;
}

/** Boots a registry with the viewer-settings handlers registered — the same shape bootstrap.ts
 *  wires, minus the rest of the daemon. `sessions` is a mutable array so a test can register
 *  extra fake sessions before dispatching a `set` and observe the broadcast on all of them. */
function boot(home: string): { registry: HandlerRegistry; sessions: (FakeSession & Session)[] } {
  const sessions: (FakeSession & Session)[] = [];
  const registry = new HandlerRegistry();
  registerViewerSettingsHandlers(registry, {
    home,
    broadcast: (targets, message) => {
      for (const s of targets) s.send({ type: "session", message });
    },
    getActiveSessions: () => sessions,
    logger: silentLogger(),
  });
  return { registry, sessions };
}

/** Dispatches one session RPC through the real router, targeting `session` (defaults to a fresh
 *  one not in `sessions`, matching a request from a client with no other open connection), and
 *  returns the raw response message. */
async function dispatch(
  registry: HandlerRegistry,
  message: Record<string, unknown>,
  session: FakeSession & Session = fakeSession(),
): Promise<{ session: FakeSession & Session; response: unknown }> {
  const requestId = message.requestId ?? "r1";
  await routeTextFrame(
    session,
    JSON.stringify({ type: "session", message: { ...message, requestId } }),
    registry,
  );
  const envelope = session.sent.at(-1) as { type: string; message: unknown };
  return { session, response: envelope?.message };
}

async function rpcGet(
  registry: HandlerRegistry,
  session?: FakeSession & Session,
): Promise<ViewerSettingsGetResponse> {
  const { response } = await dispatch(registry, { type: "viewer_settings_get_request" }, session);
  return viewerSettingsGetResponseSchema.parse(response);
}

async function rpcSet(
  registry: HandlerRegistry,
  patch: Record<string, unknown>,
  session?: FakeSession & Session,
): Promise<ViewerSettingsSetResponse> {
  const { response } = await dispatch(
    registry,
    { type: "viewer_settings_set_request", patch },
    session,
  );
  return viewerSettingsSetResponseSchema.parse(response);
}

describe("viewer_settings_get_request", () => {
  it("on a daemon with no viewer-settings.json answers all-enabled defaults and creates no file", async () => {
    const home = await tempHome();
    const { registry } = boot(home);

    const res = await rpcGet(registry);
    expect(res.payload.settings).toEqual({ version: 1, viewers: {} });
    expect(await readdir(home)).toEqual([]);
  });
});

describe("viewer_settings_set_request", () => {
  it("persists a disable, answers the effective document, and leaves exactly one file", async () => {
    const home = await tempHome();
    const { registry } = boot(home);

    const res = await rpcSet(registry, { molviewer: { enabled: false } });
    expect(res.payload.settings.viewers["molviewer"]).toEqual({ enabled: false });

    const entries = await readdir(home);
    expect(entries).toEqual(["viewer-settings.json"]);

    const reGet = await rpcGet(registry);
    expect(reGet.payload.settings.viewers["molviewer"]).toEqual({ enabled: false });
  });

  it("an unknown viewer id is accepted and round-trips through get", async () => {
    const home = await tempHome();
    const { registry } = boot(home);

    await rpcSet(registry, { "totally-unknown-viewer": { enabled: false } });
    const res = await rpcGet(registry);
    expect(res.payload.settings.viewers["totally-unknown-viewer"]).toEqual({ enabled: false });
  });

  it("a config-only patch preserves the row's existing enabled; an enabled-only patch preserves its config", async () => {
    const home = await tempHome();
    const { registry } = boot(home);

    await rpcSet(registry, { molviewer: { enabled: false, config: { autoRotate: true } } });
    await rpcSet(registry, { molviewer: { config: { theme: "dark" } } });
    let res = await rpcGet(registry);
    expect(res.payload.settings.viewers["molviewer"]).toEqual({
      enabled: false,
      config: { theme: "dark" },
    });

    await rpcSet(registry, { molviewer: { enabled: true } });
    res = await rpcGet(registry);
    expect(res.payload.settings.viewers["molviewer"]).toEqual({
      enabled: true,
      config: { theme: "dark" },
    });
  });

  it("broadcasts viewer_settings_update to every active session, including the caller", async () => {
    const home = await tempHome();
    const { registry, sessions } = boot(home);
    const caller = fakeSession();
    const other = fakeSession();
    sessions.push(caller, other);

    await rpcSet(registry, { molviewer: { enabled: false } }, caller);

    for (const s of [caller, other]) {
      const push = s.sent.find(
        (env) =>
          typeof env === "object" &&
          env !== null &&
          (env as { message?: { type?: string } }).message?.type === "viewer_settings_update",
      );
      expect(push, "session should receive the broadcast").toBeDefined();
      const parsed = viewerSettingsUpdateSchema.parse((push as { message: unknown }).message);
      expect(parsed.settings.viewers["molviewer"]).toEqual({ enabled: false });
    }
  });

  it("a malformed patch is rejected and leaves the document unchanged", async () => {
    const home = await tempHome();
    const { registry } = boot(home);
    await rpcSet(registry, { molviewer: { enabled: false } });

    const res = await rpcSet(registry, { molviewer: { enabled: "not-a-boolean" } });
    expect(res.payload.settings.viewers["molviewer"]).toEqual({ enabled: false });
  });

  it("two concurrent sets on two different viewer ids both survive (no lost update)", async () => {
    const home = await tempHome();
    const { registry } = boot(home);

    await Promise.all([
      rpcSet(registry, { molviewer: { enabled: false } }),
      rpcSet(registry, { "other-viewer": { enabled: false } }),
    ]);

    const res = await rpcGet(registry);
    expect(res.payload.settings.viewers["molviewer"]).toEqual({ enabled: false });
    expect(res.payload.settings.viewers["other-viewer"]).toEqual({ enabled: false });
  });
});
