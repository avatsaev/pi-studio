import { describe, expect, it, vi } from "vitest";
import type { PiStudioClient } from "@av-pi-studio/client";
import { watchFile } from "./use-file-watch.js";

/** Mirrors the `fakeClient({...})` factory pattern in `stores/materialize.test.ts` (the repo's
 *  existing fake-client convention), scoped to the one surface `watchFile` touches:
 *  `client.connection.request` + `client.connection.onSessionMessage`. */
function fakeClient(subscribeResponse: Record<string, unknown> = { ok: true }): {
  client: Pick<PiStudioClient, "connection">;
  requests: Record<string, unknown>[];
  emit: (msg: unknown) => void;
} {
  const requests: Record<string, unknown>[] = [];
  const handlers = new Set<(msg: unknown) => void>();
  const client = {
    connection: {
      request: (type: string, payload: Record<string, unknown>) => {
        requests.push({ type, ...payload });
        return Promise.resolve(type === "file_watch_subscribe" ? subscribeResponse : { ok: true });
      },
      onSessionMessage: (handler: (msg: unknown) => void) => {
        handlers.add(handler);
        return () => handlers.delete(handler);
      },
    },
  } as unknown as Pick<PiStudioClient, "connection">;
  return {
    client,
    requests,
    emit: (msg: unknown) => {
      for (const h of handlers) h(msg);
    },
  };
}

describe("watchFile", () => {
  it("sends file_watch_subscribe for the path on call", () => {
    const { client, requests } = fakeClient();
    watchFile(client, "/repo/mol.pdb", vi.fn());
    expect(requests).toEqual([{ type: "file_watch_subscribe", path: "/repo/mol.pdb" }]);
  });

  it("calls onChanged only for a file_changed push matching the subscribed path", () => {
    const { client, emit } = fakeClient();
    const onChanged = vi.fn();
    watchFile(client, "/repo/mol.pdb", onChanged);

    emit({ type: "file_changed", path: "/repo/other.pdb" });
    expect(onChanged).not.toHaveBeenCalled();

    emit({ type: "file_changed", path: "/repo/mol.pdb" });
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(onChanged).toHaveBeenCalledWith(expect.any(Number));

    emit({ type: "checkout_status_update", cwd: "/repo" }); // unrelated message type — ignored
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it("cleanup detaches the message handler and sends file_watch_unsubscribe", () => {
    const { client, requests, emit } = fakeClient();
    const onChanged = vi.fn();
    const cleanup = watchFile(client, "/repo/mol.pdb", onChanged);

    cleanup();
    expect(requests).toEqual([
      { type: "file_watch_subscribe", path: "/repo/mol.pdb" },
      { type: "file_watch_unsubscribe", path: "/repo/mol.pdb" },
    ]);

    // Late pushes after cleanup are ignored (the `cancelled` flag), not just unreachable because
    // the handler was removed — mirrors `use-checkout-status.ts`'s own belt-and-braces guard.
    emit({ type: "file_changed", path: "/repo/mol.pdb" });
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("a path-change resubscribe (cleanup-old-then-watch-new) unsubscribes the OLD path first", () => {
    const { client, requests } = fakeClient();
    const cleanupA = watchFile(client, "/repo/a.pdb", vi.fn());
    cleanupA();
    watchFile(client, "/repo/b.pdb", vi.fn());

    expect(requests).toEqual([
      { type: "file_watch_subscribe", path: "/repo/a.pdb" },
      { type: "file_watch_unsubscribe", path: "/repo/a.pdb" },
      { type: "file_watch_subscribe", path: "/repo/b.pdb" },
    ]);
  });

  it("cleanup is idempotent and never double-sends file_watch_unsubscribe", () => {
    const { client, requests } = fakeClient();
    const cleanup = watchFile(client, "/repo/mol.pdb", vi.fn());
    cleanup();
    cleanup();
    expect(requests.filter((r) => r.type === "file_watch_unsubscribe")).toHaveLength(1);
  });

  it("two watchFile calls for the same path share exactly one daemon subscription", () => {
    const { client, requests, emit } = fakeClient();
    const onChangedA = vi.fn();
    const onChangedB = vi.fn();
    const cleanupA = watchFile(client, "/repo/a.ts", onChangedA);
    watchFile(client, "/repo/a.ts", onChangedB);

    expect(requests.filter((r) => r.type === "file_watch_subscribe")).toHaveLength(1);

    cleanupA();
    expect(requests.filter((r) => r.type === "file_watch_unsubscribe")).toHaveLength(0);

    emit({ type: "file_changed", path: "/repo/a.ts" });
    expect(onChangedA).not.toHaveBeenCalled();
    expect(onChangedB).toHaveBeenCalledTimes(1);
  });

  it("the second subscriber's cleanup sends exactly one file_watch_unsubscribe", () => {
    const { client, requests } = fakeClient();
    const cleanupA = watchFile(client, "/repo/a.ts", vi.fn());
    const cleanupB = watchFile(client, "/repo/a.ts", vi.fn());

    cleanupA();
    cleanupB();
    expect(requests.filter((r) => r.type === "file_watch_unsubscribe")).toHaveLength(1);
  });

  it("matches a push against the resolved path echoed by the subscribe response", async () => {
    const { client, emit } = fakeClient({ ok: true, path: "/home/u/p/a.ts" });
    const onChanged = vi.fn();
    watchFile(client, "~/p/a.ts", onChanged);

    await Promise.resolve(); // flushes the pending microtask that reads the subscribe response

    emit({ type: "file_changed", path: "/home/u/p/a.ts" });
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it("a failed subscribe (too_many_watches) does not throw and leaves cleanup callable", async () => {
    const { client } = fakeClient({ ok: false, error: "too_many_watches" });
    const cleanup = watchFile(client, "/repo/a.ts", vi.fn());

    await Promise.resolve(); // flushes the pending microtask that reads the subscribe response

    expect(() => cleanup()).not.toThrow();
  });
});
