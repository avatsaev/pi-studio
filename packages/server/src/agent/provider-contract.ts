import type {
  AgentCapabilityFlags,
  AgentSessionConfig,
  AgentStreamEvent,
  ImageAttachment,
} from "@av-pi-studio/protocol";

import type { AgentFeature } from "../persistence/entity-schemas.js";
import type { TimelineRow } from "./timeline-store.js";

/**
 * Provider-neutral agent contracts (features/agent-providers.md § AgentClient / § AgentSession /
 * § Capability flags). The rest of the daemon depends only on these interfaces, never on a concrete
 * provider (`pi`, `mock`), so providers stay swappable.
 */

export type Unsubscribe = () => void;

/** Resume / persistence handle for a provider-native session. */
export interface PersistenceHandle {
  provider: string;
  sessionId?: string;
  /** Provider-opaque resume token (e.g. the Pi JSONL session file path). */
  nativeHandle?: unknown;
  metadata?: Record<string, unknown>;
}

export interface AgentModelDefinition {
  id: string;
  label?: string;
  description?: string;
}

export interface AgentModeDefinition {
  id: string;
  label?: string;
  description?: string;
}

export interface AgentCommandDefinition {
  id: string;
  label?: string;
  description?: string;
}

/** Runtime info echoed from a live session. */
export interface ProviderRuntimeInfo {
  provider: string;
  sessionId?: string;
  model?: string;
  thinkingOptionId?: string;
  modeId?: string;
  extra?: Record<string, unknown>;
}

export interface PendingPermission {
  requestId: string;
  toolName?: string;
  detail?: unknown;
}

/** Context passed when launching/resuming a session (cwd, env, logger, …). */
export interface LaunchContext {
  cwd?: string;
  env?: Record<string, string>;
  logger?: Pick<Console, "info" | "warn" | "error">;
}

export interface RunOptions {
  images?: ImageAttachment[];
  attachments?: unknown;
  clientMessageId?: string;
  outputSchema?: Record<string, unknown>;
}

export type StartTurnOptions = RunOptions;

export interface CreateSessionOptions {
  env?: Record<string, string>;
}

/** A row in the importable-session picker (no full transcript). */
export interface ImportableSessionRow {
  providerHandleId: string;
  cwd: string;
  title?: string;
  promptPreview?: string;
  lastActivityAt?: string;
}

export interface ImportSessionArgs {
  providerHandleId: string;
  cwd: string;
}

export interface ImportSessionResult {
  session: AgentSession;
  persistence: PersistenceHandle;
  timeline: AgentStreamEvent[];
}

/** One running instance of an agent: one provider, one model, one cwd, one timeline. */
export interface AgentSession {
  readonly provider: string;
  readonly id: string;
  readonly capabilities: AgentCapabilityFlags;
  readonly features?: AgentFeature[];

  run(prompt: string, opts?: RunOptions): Promise<void>;
  startTurn(prompt: string, opts?: StartTurnOptions): Promise<{ turnId: string }>;

  subscribe(cb: (event: AgentStreamEvent) => void): Unsubscribe;
  streamHistory(): AsyncGenerator<AgentStreamEvent>;

  getRuntimeInfo(): ProviderRuntimeInfo;
  getAvailableModes(): AgentModeDefinition[];
  getCurrentMode(): string | null;
  setMode(id: string): Promise<void>;

  getPendingPermissions(): PendingPermission[];
  respondToPermission(requestId: string, response: unknown): Promise<void>;

  describePersistence(): PersistenceHandle | null;
  interrupt(): Promise<void>;
  close(): Promise<void>;

  // Optional capabilities.
  listCommands?(): Promise<AgentCommandDefinition[]>;
  setModel?(id: string): Promise<void>;
  setThinkingOption?(id: string): Promise<void>;
  setFeature?(id: string, value: unknown): Promise<void>;
  tryHandleOutOfBand?(message: unknown): boolean;
}

/** A provider client: creates/resumes sessions and exposes discovery. */
export interface AgentClient {
  readonly provider: string;
  readonly capabilities: AgentCapabilityFlags;

  createSession(
    config: AgentSessionConfig,
    launchContext?: LaunchContext,
    options?: CreateSessionOptions,
  ): Promise<AgentSession>;

  resumeSession(
    handle: PersistenceHandle,
    overrides?: Partial<AgentSessionConfig>,
    launchContext?: LaunchContext,
  ): Promise<AgentSession>;

  listModels(opts?: { cwd?: string }): Promise<AgentModelDefinition[]>;
  isAvailable(): Promise<boolean> | boolean;

  // Optional capabilities.
  listModes?(opts?: { cwd?: string }): Promise<AgentModeDefinition[]>;
  listImportableSessions?(opts?: { cwd?: string }): Promise<ImportableSessionRow[]>;
  importSession?(args: ImportSessionArgs): Promise<ImportSessionResult>;
  getDiagnostic?(): Promise<unknown>;
  /**
   * Rebuild a full timeline from a provider-native resume handle, without spawning a live
   * session. Used when the daemon's in-memory `AgentTimelineStore` is empty (e.g. after a
   * restart) but the agent record still carries a `persistence` handle — the `pi` provider
   * implements this by reading its own on-disk JSONL session file
   * (`session-hydration.ts`). Providers without durable native history omit this.
   */
  hydrateTimeline?(handle: PersistenceHandle): TimelineRow[];
}
