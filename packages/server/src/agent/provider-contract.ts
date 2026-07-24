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

/** Result shapes for the slash-command operations (sprint-037), mirroring Pi RPC response data. */
export interface AgentSessionStats {
  sessionId?: string;
  sessionFile?: string;
  userMessages?: number;
  assistantMessages?: number;
  toolCalls?: number;
  toolResults?: number;
  totalMessages?: number;
  tokens?: {
    input?: number;
    output?: number;
    cacheRead?: number;
    cacheWrite?: number;
    total?: number;
  };
  cost?: number;
  contextUsage?: { tokens?: number | null; contextWindow?: number; percent?: number | null };
  /** Current model id (sprint-042: back-filled from `getRuntimeInfo()` when the provider's own
   * stats payload omits it, so the periodic stats poll is a self-correcting model source). */
  model?: string;
}

export interface AgentCompactResult {
  summary?: string;
  firstKeptEntryId?: string;
  tokensBefore?: number;
  details?: unknown;
}

export interface AgentForkMessage {
  entryId: string;
  text: string;
}

export interface AgentCycleModelResult {
  model?: unknown;
  thinkingLevel?: string;
  isScoped?: boolean;
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

/** Options for a steering / follow-up message injected into a live turn. */
export interface SteerOptions {
  images?: ImageAttachment[];
}

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

  // Steering (features/agent-sessions.md § Steering) — inject a message into a LIVE turn without
  // starting a new turn. Fire-and-forget, mirroring Pi RPC `steer`/`follow_up`. Present only where
  // the provider supports it (capabilities.supportsSteering).
  /** `steer` — queue a message delivered after the current assistant turn's tool calls. */
  steer?(message: string, opts?: SteerOptions): Promise<void>;
  /** `follow_up` — queue a message delivered only after the agent fully stops. */
  followUp?(message: string, opts?: SteerOptions): Promise<void>;

  // Slash-command operations (sprint-037) — optional, present only where the provider RPC exists.
  /** `/session` — mirrors Pi RPC `get_session_stats`. */
  getSessionStats?(): Promise<AgentSessionStats>;
  /** `/compact` — mirrors Pi RPC `compact`. */
  compact?(customInstructions?: string): Promise<AgentCompactResult>;
  /** `/new` — mirrors Pi RPC `new_session`. Does NOT replace this `AgentSession` instance. */
  newSession?(): Promise<{ cancelled: boolean }>;
  /** `/resume` — mirrors Pi RPC `switch_session`. */
  switchSession?(sessionPath: string): Promise<{ cancelled: boolean }>;
  /** `/fork` — mirrors Pi RPC `fork`. */
  fork?(entryId: string): Promise<{ text: string; cancelled: boolean }>;
  /** Fork picker — mirrors Pi RPC `get_fork_messages`. */
  getForkMessages?(): Promise<AgentForkMessage[]>;
  /** `/clone` — mirrors Pi RPC `clone`. */
  clone?(): Promise<{ cancelled: boolean }>;
  /** `/name` — mirrors Pi RPC `set_session_name`. */
  setSessionName?(name: string): Promise<void>;
  /** `/export` — mirrors Pi RPC `export_html`. */
  exportHtml?(outputPath?: string): Promise<{ path: string }>;
  /** `/model` (set) — mirrors Pi RPC `set_model` (distinct from the legacy string-only `setModel?`). */
  setProviderModel?(provider: string, modelId: string): Promise<unknown>;
  /** `/model` (cycle) — mirrors Pi RPC `cycle_model`. */
  cycleModel?(): Promise<AgentCycleModelResult>;
  /** `/copy` — mirrors Pi RPC `get_last_assistant_text`. */
  getLastAssistantText?(): Promise<string | null>;
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
