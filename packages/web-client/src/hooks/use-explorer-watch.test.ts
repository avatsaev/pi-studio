import { describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import type { PiStudioClient } from "@av-pi-studio/client";
import { createExplorerWatcher } from "./use-explorer-watch.js";
import { rpcKeys } from "@pi-studio-ui/lib/connection/rpc-keys.js";

/** Mirrors the `fakeClient({...})` factory convention (`stores/materialize.test.ts`), scoped to
 *  the surface `createExplorerWatcher` touches: `client.connection.request` +
 *  `client.connection.onSessionMessage`. */
function fakeClient(): {
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
        return Promise.resolve({ ok: true });
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

describe("createExplorerWatcher", () => {
  it("sync subscribes every path in an initially-expanded set", () => {
    const { client, requests } = fakeClient();
    const watcher = createExplorerWatcher(client, vi.fn());
    watcher.sync(new Set(["/repo", "/repo/src"]));

    expect(requests.map((r) => r.path).toSorted()).toEqual(["/repo", "/repo/src"]);
    expect(requests.every((r) => r.type === "file_watch_subscribe")).toBe(true);
  });

  it("a subsequent sync with an unchanged set issues zero new RPCs (no churn)", () => {
    const { client, requests } = fakeClient();
    const watcher = createExplorerWatcher(client, vi.fn());
    watcher.sync(new Set(["/repo"]));
    expect(requests).toHaveLength(1);

    // A logically-identical but freshly-constructed Set (the regression that matters most here).
    watcher.sync(new Set(["/repo"]));
    expect(requests).toHaveLength(1);
  });

  it("expanding subscribes exactly the new path; collapsing unsubscribes exactly it", () => {
    const { client, requests } = fakeClient();
    const watcher = createExplorerWatcher(client, vi.fn());
    watcher.sync(new Set(["/repo"]));
    watcher.sync(new Set(["/repo", "/repo/src"])); // expand src
    expect(requests).toEqual([
      { type: "file_watch_subscribe", path: "/repo" },
      { type: "file_watch_subscribe", path: "/repo/src" },
    ]);

    watcher.sync(new Set(["/repo"])); // collapse src
    expect(requests).toEqual([
      { type: "file_watch_subscribe", path: "/repo" },
      { type: "file_watch_subscribe", path: "/repo/src" },
      { type: "file_watch_unsubscribe", path: "/repo/src" },
    ]);
    // /repo itself was never touched by either transition.
    expect(requests.filter((r) => r.path === "/repo")).toHaveLength(1);
  });

  it("a wholesale set swap (workspace-tab switch) unsubscribes every old-root path and subscribes every new-root path, with no orphans", () => {
    const { client, requests } = fakeClient();
    const watcher = createExplorerWatcher(client, vi.fn());
    watcher.sync(new Set(["/repoA", "/repoA/src"]));

    watcher.sync(new Set(["/repoB", "/repoB/lib"])); // explorer-store.setRoot swaps wholesale

    const unsubs = requests.filter((r) => r.type === "file_watch_unsubscribe").map((r) => r.path);
    const subs = requests.filter((r) => r.type === "file_watch_subscribe").map((r) => r.path);
    expect(unsubs.toSorted()).toEqual(["/repoA", "/repoA/src"]);
    expect(subs.toSorted()).toEqual(["/repoA", "/repoA/src", "/repoB", "/repoB/lib"]);
  });

  it("invokes onChanged only for a file_changed push matching a currently-subscribed path", () => {
    const { client, emit } = fakeClient();
    const onChanged = vi.fn();
    const watcher = createExplorerWatcher(client, onChanged);
    watcher.sync(new Set(["/repo"]));

    emit({ type: "file_changed", path: "/unrelated" });
    expect(onChanged).not.toHaveBeenCalled();

    emit({ type: "file_changed", path: "/repo" });
    expect(onChanged).toHaveBeenCalledWith("/repo");
    expect(onChanged).toHaveBeenCalledTimes(1);

    // Collapsed directories stop matching even though the daemon subscription might still be
    // draining in flight — `subscribed` is the local source of truth for routing.
    watcher.sync(new Set());
    emit({ type: "file_changed", path: "/repo" });
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it("dispose detaches the handler and unsubscribes every held path", () => {
    const { client, requests, emit } = fakeClient();
    const onChanged = vi.fn();
    const watcher = createExplorerWatcher(client, onChanged);
    watcher.sync(new Set(["/repo", "/repo/src"]));
    watcher.dispose();

    expect(
      requests
        .filter((r) => r.type === "file_watch_unsubscribe")
        .map((r) => r.path)
        .toSorted(),
    ).toEqual(["/repo", "/repo/src"]);

    emit({ type: "file_changed", path: "/repo" });
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("invalidates exactly rpcKeys.explorer(path) on a matching push, using a real QueryClient", async () => {
    const { client, emit } = fakeClient();
    const queryClient = new QueryClient();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    const watcher = createExplorerWatcher(client, (path) => {
      void queryClient.invalidateQueries({ queryKey: rpcKeys.explorer(path) });
    });
    watcher.sync(new Set(["/repo/src"]));

    emit({ type: "file_changed", path: "/repo/src" });

    expect(invalidateSpy).toHaveBeenCalledTimes(1);
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: rpcKeys.explorer("/repo/src") });
  });
});
