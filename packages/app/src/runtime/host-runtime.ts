// Host runtime controller: saved hosts → connection state snapshots.
// client-app-runtime.md § Connection, app-navigation-screens.md § Routing ↔ runtime wiring

import type { HostProfile } from "./host-profile.js";

export type ConnectionStatus = "idle" | "connecting" | "online" | "offline" | "error";

export type HostFeatures = Record<string, boolean | string | number | undefined>;

export type ServerInfo = {
  serverId: string;
  features: HostFeatures;
};

export type ConnectedDaemonClient = {
  serverInfo: ServerInfo;
  onDrop(callback: (error?: Error) => void): () => void;
  disconnect?(): void | Promise<void>;
};

export type HostConnector = {
  connect(profile: HostProfile): Promise<ConnectedDaemonClient>;
};

export type Scheduler = {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout?(handle: unknown): void;
};

export type HostRuntimeSnapshot = {
  profile: HostProfile;
  status: ConnectionStatus;
  client?: ConnectedDaemonClient;
  serverId?: string;
  features: HostFeatures;
  lastError?: string;
  lastOnlineAtMs?: number;
  reconnectAttempt: number;
};

export type HostRuntimeControllerOptions = {
  connector: HostConnector;
  scheduler?: Scheduler;
  now?: () => number;
  backoffMs?: (attempt: number) => number;
};

const DEFAULT_SCHEDULER: Scheduler = {
  setTimeout(callback, delayMs) {
    return setTimeout(callback, delayMs);
  },
  clearTimeout(handle) {
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
};

const DEFAULT_BACKOFF = (attempt: number): number => Math.min(30_000, 500 * 2 ** Math.max(0, attempt - 1));

export class HostRuntimeController {
  private readonly connector: HostConnector;
  private readonly scheduler: Scheduler;
  private readonly now: () => number;
  private readonly backoffMs: (attempt: number) => number;
  private readonly snapshots = new Map<string, HostRuntimeSnapshot>();
  private readonly reconnectTimers = new Map<string, unknown>();
  private storeReady = false;

  constructor(profiles: HostProfile[], options: HostRuntimeControllerOptions) {
    this.connector = options.connector;
    this.scheduler = options.scheduler ?? DEFAULT_SCHEDULER;
    this.now = options.now ?? (() => Date.now());
    this.backoffMs = options.backoffMs ?? DEFAULT_BACKOFF;

    for (const profile of profiles) {
      this.snapshots.set(profile.id, {
        profile,
        status: "idle",
        features: {},
        reconnectAttempt: 0,
      });
    }
  }

  getStoreReady(): boolean {
    return this.storeReady;
  }

  latchStoreReady(): void {
    this.storeReady = true;
  }

  list(): HostRuntimeSnapshot[] {
    return [...this.snapshots.values()].sort((a, b) => a.profile.createdAtMs - b.profile.createdAtMs);
  }

  get(profileIdOrServerId: string): HostRuntimeSnapshot | undefined {
    return this.list().find(
      (s) => s.profile.id === profileIdOrServerId || s.serverId === profileIdOrServerId || s.profile.serverId === profileIdOrServerId,
    );
  }

  getByServerId(serverId: string): HostRuntimeSnapshot | undefined {
    return this.list().find((s) => s.serverId === serverId || s.profile.serverId === serverId);
  }

  earliestOnlineHost(): HostRuntimeSnapshot | undefined {
    return this.list().find((s) => s.status === "online");
  }

  knownServerIds(): string[] {
    return this.list()
      .map((s) => s.serverId ?? s.profile.serverId)
      .filter((id): id is string => typeof id === "string" && id.length > 0);
  }

  async connectAll(): Promise<void> {
    await Promise.all(this.list().map((s) => this.connectHost(s.profile.id)));
  }

  async connectHost(profileId: string): Promise<void> {
    const snap = this.snapshots.get(profileId);
    if (!snap) throw new Error(`Unknown host profile: ${profileId}`);

    this.setSnapshot(profileId, { status: "connecting", lastError: undefined });
    try {
      const client = await this.connector.connect(snap.profile);
      const { serverId, features } = client.serverInfo;
      const unsubscribe = client.onDrop((error) => {
        unsubscribe();
        this.handleDrop(profileId, error);
      });
      this.setSnapshot(profileId, {
        status: "online",
        client,
        serverId,
        features,
        lastOnlineAtMs: this.now(),
        lastError: undefined,
        reconnectAttempt: 0,
      });
      this.latchStoreReady();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.setSnapshot(profileId, { status: "error", lastError: message, client: undefined });
      this.scheduleReconnect(profileId);
    }
  }

  private handleDrop(profileId: string, error?: Error): void {
    this.setSnapshot(profileId, {
      status: "offline",
      client: undefined,
      lastError: error?.message,
    });
    this.scheduleReconnect(profileId);
  }

  private scheduleReconnect(profileId: string): void {
    const snap = this.snapshots.get(profileId);
    if (!snap) return;
    const attempt = snap.reconnectAttempt + 1;
    this.setSnapshot(profileId, { reconnectAttempt: attempt });
    const delay = this.backoffMs(attempt);
    const handle = this.scheduler.setTimeout(() => {
      this.reconnectTimers.delete(profileId);
      void this.connectHost(profileId);
    }, delay);
    this.reconnectTimers.set(profileId, handle);
  }

  clearReconnect(profileId: string): void {
    const handle = this.reconnectTimers.get(profileId);
    if (handle && this.scheduler.clearTimeout) this.scheduler.clearTimeout(handle);
    this.reconnectTimers.delete(profileId);
  }

  private setSnapshot(profileId: string, patch: Partial<HostRuntimeSnapshot>): void {
    const current = this.snapshots.get(profileId);
    if (!current) return;
    this.snapshots.set(profileId, { ...current, ...patch });
  }
}
