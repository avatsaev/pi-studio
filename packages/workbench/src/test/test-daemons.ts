/**
 * An in-memory `HostDaemons` for tests, following `swe/features/desktop-daemon-registry.md`: names
 * unique without case, the local entry not removable, the spec's error codes, and a scripted local
 * daemon. Secrets stay inside; `snapshot()` never returns them. Not exported from the package.
 */

import {
  type ConnectIntent,
  type DaemonEntryView,
  type DaemonError as DaemonErrorShape,
  type DaemonErrorCode,
  type DaemonPatch,
  type DaemonSettings,
  type HostDaemons,
  type LocalDaemonState,
  type NewDaemon,
} from "../host/types.js";

interface StoredEntry {
  id: string;
  kind: DaemonEntryView["kind"];
  name: string;
  address?: string;
  password?: string;
  pairingLink?: string;
}

export interface TestDaemonsOptions {
  /** Extra entries after `local`. */
  entries?: Array<NewDaemon & { id?: string }>;
  currentId?: string | null;
  local?: LocalDaemonState;
  settings?: Partial<DaemonSettings>;
  /** Password of the local entry. */
  localPassword?: string;
  /** The state a `start` or `restart` ends in (default: running on 127.0.0.1:7777). */
  startOutcome?: LocalDaemonState;
}

export interface TestDaemons extends HostDaemons {
  /** Ids passed to `switchTo`, in order. */
  switches: string[];
  /** Replace the local state and notify. */
  setLocalState(state: LocalDaemonState): void;
  /** Fire every `onManageRequest` listener. */
  requestManage(): void;
  /** Resolves when the scripted local action in flight has reached its outcome. */
  settled(): Promise<void>;
  listenerCount(): number;
}

/** The error a test registry rejects with; satisfies the contract's `DaemonError`. */
export class DaemonError extends Error implements DaemonErrorShape {
  readonly code: DaemonErrorCode;

  constructor(code: DaemonErrorCode) {
    super(code);
    this.name = "DaemonError";
    this.code = code;
  }
}

const MAX_ENTRIES = 64;
const DEFAULT_RUNNING: LocalDaemonState = { state: "running", host: "127.0.0.1", port: 7777 };
const LOCAL_FAILURES = ["unsupported", "cli_missing", "cli_outdated"] as const;

function view(entry: StoredEntry): DaemonEntryView {
  return {
    id: entry.id,
    kind: entry.kind,
    name: entry.name,
    ...(entry.address === undefined ? {} : { address: entry.address }),
    hasPassword: entry.password !== undefined,
  };
}

function validAddress(address: string): string {
  if (address.trim().length === 0 || address.length > 2048)
    throw new DaemonError("invalid_address");
  return address;
}
function validLink(link: string): string {
  if (link.trim().length === 0 || link.length > 4096) throw new DaemonError("invalid_link");
  return link;
}

export function createTestDaemons(options: TestDaemonsOptions = {}): TestDaemons {
  let nextId = 0;
  const entries: StoredEntry[] = [
    {
      id: "local",
      kind: "local",
      name: "This machine",
      ...(options.localPassword === undefined ? {} : { password: options.localPassword }),
    },
  ];
  let currentId: string | null = options.currentId === undefined ? "local" : options.currentId;
  let local: LocalDaemonState = options.local ?? { state: "stopped" };
  let settings: DaemonSettings = {
    autoStartLocalDaemon: true,
    cliPath: null,
    ...options.settings,
  };
  const listeners = new Set<() => void>();
  const manageListeners = new Set<() => void>();
  const switches: string[] = [];
  let pending: Promise<void> = Promise.resolve();

  const notify = (): void => {
    for (const listener of listeners) listener();
  };
  const setLocal = (state: LocalDaemonState): void => {
    local = state;
    notify();
  };
  const validName = (name: string, exceptId?: string): string => {
    const trimmed = name.trim();
    if (trimmed.length < 1 || trimmed.length > 64) throw new DaemonError("invalid_name");
    const lower = trimmed.toLowerCase();
    if (entries.some((e) => e.id !== exceptId && e.name.toLowerCase() === lower)) {
      throw new DaemonError("name_taken");
    }
    return trimmed;
  };
  const find = (id: string): StoredEntry => {
    const entry = entries.find((e) => e.id === id);
    if (!entry) throw new DaemonError("not_found");
    return entry;
  };

  const add = (input: NewDaemon, id?: string): StoredEntry => {
    if (entries.length >= MAX_ENTRIES) throw new DaemonError("too_many");
    const name = validName(input.name);
    const entry: StoredEntry =
      input.kind === "direct"
        ? {
            id: id ?? `direct-${++nextId}`,
            kind: "direct",
            name,
            address: validAddress(input.address),
            ...(input.password ? { password: input.password } : {}),
          }
        : {
            id: id ?? `relay-${++nextId}`,
            kind: "relay",
            name,
            pairingLink: validLink(input.pairingLink),
          };
    entries.push(entry);
    return entry;
  };
  for (const seed of options.entries ?? []) add(seed, seed.id);

  const runAction = async (): Promise<void> => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    setLocal(options.startOutcome ?? DEFAULT_RUNNING);
  };
  const begin = (busy: LocalDaemonState["state"][]): void => {
    for (const code of LOCAL_FAILURES) if (local.state === code) throw new DaemonError(code);
    if (busy.includes(local.state)) throw new DaemonError("busy");
  };
  const startAction = async (): Promise<void> => {
    begin(["starting", "stopping"]);
    setLocal({ state: "starting" });
    pending = runAction();
  };

  const resolveLocal = async (entry: StoredEntry): Promise<ConnectIntent> => {
    const intent = (state: Extract<LocalDaemonState, { state: "running" }>): ConnectIntent => ({
      url: `ws://${state.host}:${state.port}`,
      ...(entry.password === undefined ? {} : { password: entry.password }),
      connect: true,
    });
    for (const code of LOCAL_FAILURES) if (local.state === code) throw new DaemonError(code);
    if (local.state === "running") return intent(local);
    if (local.state === "failed") throw new DaemonError(local.reason);
    if (local.state === "stopped" && !settings.autoStartLocalDaemon) {
      throw new DaemonError("local_stopped");
    }
    if (local.state === "stopped") await startAction();
    await pending;
    const after = local as LocalDaemonState;
    if (after.state === "running") return intent(after);
    if (after.state === "failed") throw new DaemonError(after.reason);
    throw new DaemonError("local_stopped");
  };

  return {
    switches,
    setLocalState: setLocal,
    requestManage: () => {
      for (const listener of manageListeners) listener();
    },
    settled: () => pending,
    listenerCount: () => listeners.size,
    snapshot: () => ({
      currentId,
      entries: entries.map(view),
      local: { ...local },
      settings: { ...settings },
    }),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    resolveCurrent: async () => {
      if (currentId === null) throw new DaemonError("no_current");
      const entry = find(currentId);
      if (entry.kind === "direct") {
        return {
          url: entry.address,
          ...(entry.password === undefined ? {} : { password: entry.password }),
          connect: true,
        };
      }
      if (entry.kind === "relay") return { url: entry.pairingLink, connect: true };
      return resolveLocal(entry);
    },
    add: async (input) => {
      const entry = add(input);
      notify();
      return view(entry);
    },
    update: async (id, patch: DaemonPatch) => {
      const entry = find(id);
      const hasAddress = patch.address !== undefined;
      const hasLink = patch.pairingLink !== undefined;
      const hasPassword = patch.password !== undefined;
      if (
        (hasAddress && entry.kind !== "direct") ||
        (hasLink && entry.kind !== "relay") ||
        (hasPassword && entry.kind === "relay")
      ) {
        throw new DaemonError("wrong_kind");
      }
      const name = patch.name === undefined ? undefined : validName(patch.name, id);
      const address = hasAddress ? validAddress(patch.address!) : undefined;
      const link = hasLink ? validLink(patch.pairingLink!) : undefined;
      if (name !== undefined) entry.name = name;
      if (address !== undefined) entry.address = address;
      if (link !== undefined) entry.pairingLink = link;
      if (hasPassword) {
        if (patch.password) entry.password = patch.password;
        else delete entry.password;
      }
      notify();
      return view(entry);
    },
    remove: async (id) => {
      const entry = find(id);
      if (entry.kind === "local") throw new DaemonError("local_not_removable");
      entries.splice(entries.indexOf(entry), 1);
      if (currentId === id) currentId = null;
      notify();
    },
    switchTo: (id) => {
      find(id);
      switches.push(id);
      currentId = id;
      notify();
      return new Promise<void>(() => {});
    },
    setSettings: async (patch) => {
      settings = { ...settings, ...patch };
      notify();
    },
    local: {
      start: startAction,
      restart: startAction,
      stop: async () => {
        begin(["starting", "stopping"]);
        setLocal({ state: "stopping" });
        pending = (async () => {
          await new Promise((resolve) => setTimeout(resolve, 0));
          setLocal({ state: "stopped" });
        })();
      },
      refresh: async () => {
        if (local.state === "unsupported") throw new DaemonError("unsupported");
        notify();
      },
    },
    onManageRequest: (listener) => {
      manageListeners.add(listener);
      return () => manageListeners.delete(listener);
    },
  };
}
