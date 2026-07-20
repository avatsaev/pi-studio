/**
 * Saved-servers store — named daemon connection entries (Settings → Servers), persisted
 * client-side so the user picks a server from a list instead of re-typing addresses.
 *
 * Persistence echoes `theme/appearance-store.ts`: one JSON blob under a single key in the
 * injected `KeyValueStore` (localStorage on web, an Electron bridge later), validated on
 * load, corrupt data tolerated — invalid entries are dropped, never thrown.
 *
 * Only direct (`host:port`) entries are supported. Relay connections additionally need the
 * relay endpoint and the daemon's live rendezvous session id, which the pairing link does
 * not carry and no RPC exposes yet — relay entries land with that daemon-side work.
 */

import { create } from "zustand";
import { localKvStore } from "@pi-studio-ui/providers/kv-store.js";

export interface SavedServer {
  id: string;
  name: string;
  /** Daemon address; anything `normalizeDaemonUrl` accepts (ws/wss/http/https/bare host). */
  url: string;
  /**
   * Optional daemon password. Stored in plaintext in localStorage — the user opts in per
   * entry; when absent, the password is asked at connect time.
   */
  password?: string;
}

export type SavedServerInput = Omit<SavedServer, "id">;

const STORAGE_KEY = "pi-studio-saved-servers";

/**
 * Parse and validate the persisted blob. Tolerant: unparseable or wrongly-shaped data
 * yields `[]` / per-entry drops, mirroring appearance-store's load path.
 */
export function parseSavedServers(raw: string | null): SavedServer[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const servers: SavedServer[] = [];
  for (const item of parsed) {
    if (typeof item !== "object" || item === null) continue;
    const { id, name, url, password } = item as Record<string, unknown>;
    if (typeof id !== "string" || id === "") continue;
    if (typeof name !== "string" || name.trim() === "") continue;
    if (typeof url !== "string" || url.trim() === "") continue;
    servers.push({
      id,
      name: name.trim(),
      url: url.trim(),
      ...(typeof password === "string" && password.trim() !== "" ? { password } : {}),
    });
  }
  return servers;
}

export interface SavedServersState {
  servers: SavedServer[];
  addServer(input: SavedServerInput): SavedServer;
  updateServer(id: string, patch: Partial<SavedServerInput>): void;
  removeServer(id: string): void;
}

export const useSavedServersStore = create<SavedServersState>()((set) => {
  function commit(servers: SavedServer[]): { servers: SavedServer[] } {
    localKvStore.set(STORAGE_KEY, JSON.stringify(servers));
    return { servers };
  }

  return {
    servers: parseSavedServers(localKvStore.get(STORAGE_KEY)),

    addServer(input) {
      const server: SavedServer = {
        id: crypto.randomUUID(),
        name: input.name.trim(),
        url: input.url.trim(),
        ...(input.password && input.password.trim() !== "" ? { password: input.password } : {}),
      };
      set((s) => commit([...s.servers, server]));
      return server;
    },

    updateServer(id, patch) {
      set((s) =>
        commit(
          s.servers.map((server) => {
            if (server.id !== id) return server;
            const next = { ...server };
            if (patch.name !== undefined) next.name = patch.name.trim();
            if (patch.url !== undefined) next.url = patch.url.trim();
            if (patch.password !== undefined) {
              if (patch.password.trim() === "") delete next.password;
              else next.password = patch.password;
            }
            return next;
          }),
        ),
      );
    },

    removeServer(id) {
      set((s) => commit(s.servers.filter((server) => server.id !== id)));
    },
  };
});
