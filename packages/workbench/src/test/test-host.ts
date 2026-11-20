/**
 * An in-memory `WorkbenchHost` for tests: storage in a `Map`, scripted dialog answers, and every
 * call recorded. Install it with `installHost` after `resetHostForTests()`.
 */

import { type KeyValueStore } from "@av-pi-studio/ui-library";
import {
  type ConnectIntent,
  type HostConnection,
  type HostDaemons,
  type HostPreview,
  type WorkbenchHost,
} from "../host/types.js";

export interface TestHostCall {
  member: string;
  args: unknown[];
}

export interface TestHostOptions {
  /** Answers for successive `dialogs.confirm` calls; missing answers are `true`. */
  confirms?: boolean[];
  storage?: Record<string, string>;
  openExternal?: boolean;
  clipboardFails?: boolean;
  /** What `launch.initialConnect()` returns. */
  connectIntent?: ConnectIntent | null;
  /** The pending agent deep link at boot. */
  agentDeepLink?: string | null;
  /** What `connection.createTransport` returns (default: `undefined`, the SDK socket). */
  createTransport?: HostConnection["createTransport"];
  /** `files.upload` rejects with this message. */
  uploadFails?: string;
  /** `files.saveToDisk` resolves only when this does. */
  saveToDisk?: Promise<void>;
  /**
   * The host's `preview`: `"inert"`, `"origin"` (mounts and releases are recorded), or
   * `{ mountFails }` (an `origin` whose `mount` rejects with that message).
   */
  preview?: "inert" | "origin" | { mountFails: string };
  /** The host's `daemons` registry, e.g. from `createTestDaemons`. Absent by default. */
  daemons?: HostDaemons;
  /** The host's `app.minDaemonVersion`. */
  minDaemonVersion?: string;
}

export interface TestHost extends WorkbenchHost {
  calls: TestHostCall[];
  data: Map<string, string>;
  /** Deliver a deep-link request to every `agentDeepLink.subscribe` listener. */
  emitAgentDeepLink(agentId: string): void;
  /** Fire every `connection.onResume` listener. */
  emitResume(): void;
  resumeListenerCount(): number;
}

export function createTestHost(options: TestHostOptions = {}): TestHost {
  const calls: TestHostCall[] = [];
  const data = new Map(Object.entries(options.storage ?? {}));
  const confirms = [...(options.confirms ?? [])];
  const record = (member: string, ...args: unknown[]): void => void calls.push({ member, args });
  const deepLinkListeners = new Set<(agentId: string) => void>();
  let pendingDeepLink = options.agentDeepLink ?? null;
  const resumeListeners = new Set<() => void>();
  let viewCount = 0;
  let mountCount = 0;
  const preview: HostPreview | undefined =
    options.preview === undefined
      ? undefined
      : options.preview === "inert"
        ? { kind: "inert" }
        : {
            kind: "origin",
            mount: async (html) => {
              record("preview.mount", html);
              if (typeof options.preview === "object") throw new Error(options.preview.mountFails);
              const url = `test-preview:${++mountCount}`;
              return { url, release: () => record("preview.release", url) };
            },
          };

  const storage: KeyValueStore = {
    get: (key) => data.get(key) ?? null,
    set: (key, value) => void data.set(key, value),
  };

  return {
    calls,
    data,
    emitAgentDeepLink: (agentId) => {
      for (const listener of deepLinkListeners) listener(agentId);
    },
    emitResume: () => {
      for (const listener of resumeListeners) listener();
    },
    resumeListenerCount: () => resumeListeners.size,
    app: {
      title: "Test",
      version: "0.0.0-test",
      ...(options.minDaemonVersion === undefined
        ? {}
        : { minDaemonVersion: options.minDaemonVersion }),
    },
    storage,
    clipboard: {
      writeText: async (text) => {
        record("clipboard.writeText", text);
        if (options.clipboardFails) throw new Error("clipboard unavailable");
      },
    },
    dialogs: {
      confirm: async (message) => {
        record("dialogs.confirm", message);
        return confirms.shift() ?? true;
      },
      alert: async (message) => record("dialogs.alert", message),
    },
    links: options.openExternal ? { openExternal: (url) => record("links.openExternal", url) } : {},
    launch: {
      initialConnect: () => {
        record("launch.initialConnect");
        return options.connectIntent ?? null;
      },
      agentDeepLink: {
        current: () => pendingDeepLink,
        subscribe: (listener) => {
          deepLinkListeners.add(listener);
          return () => deepLinkListeners.delete(listener);
        },
        consume: () => {
          record("launch.agentDeepLink.consume");
          pendingDeepLink = null;
        },
      },
    },
    connection: {
      createTransport: (target, connectOptions) => {
        record("connection.createTransport", target, connectOptions);
        return options.createTransport?.(target, connectOptions);
      },
      timers: {
        setTimer: (cb, ms) => setTimeout(cb, ms),
        clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
      },
      onResume: (listener) => {
        resumeListeners.add(listener);
        return () => resumeListeners.delete(listener);
      },
    },
    files: {
      upload: async (dir, source) => {
        record("files.upload", dir, source.name);
        if (options.uploadFails) throw new Error(options.uploadFails);
      },
      saveToDisk: async (path) => {
        record("files.saveToDisk", path);
        if (options.saveToDisk) await options.saveToDisk;
      },
      openForView: async (path) => {
        const url = `test-view:${path}#${++viewCount}`;
        record("files.openForView", path, url);
        return { url, release: () => record("files.release", url) };
      },
    },
    ...(preview ? { preview } : {}),
    ...(options.daemons ? { daemons: options.daemons } : {}),
  };
}
