import { randomUUID } from "node:crypto";

import type {
  AgentCapabilityFlags,
  AgentSessionConfig,
  AgentStreamEvent,
} from "@av-pi-studio/protocol";

import type {
  AgentClient,
  AgentCommandDefinition,
  AgentModeDefinition,
  AgentModelDefinition,
  AgentSession,
  CreateSessionOptions,
  LaunchContext,
  PendingPermission,
  PersistenceHandle,
  ProviderRuntimeInfo,
  Unsubscribe,
} from "../../provider-contract.js";

/**
 * In-process `mock` provider (features/agent-providers.md § Provider entry — dev/test only). It
 * implements the `AgentClient`/`AgentSession` contracts in memory and emits a scripted turn. Never
 * user-selectable in production paths.
 */

export const MOCK_CAPABILITIES: AgentCapabilityFlags = {
  supportsStreaming: true,
  supportsSessionPersistence: true,
  supportsDynamicModes: true,
  supportsMcpServers: false,
  supportsReasoningStream: true,
  supportsToolInvocations: true,
  supportsSteering: true,
};

const MOCK_MODES: AgentModeDefinition[] = [
  { id: "default", label: "Default" },
  { id: "plan", label: "Plan" },
];

export interface MockSessionOptions {
  /** Delay before a started turn completes (ms). Small but non-zero so `interrupt` can win. */
  turnDelayMs?: number;
}

class MockAgentSession implements AgentSession {
  readonly provider = "mock";
  readonly id = randomUUID();
  readonly capabilities = MOCK_CAPABILITIES;

  private readonly subscribers = new Set<(event: AgentStreamEvent) => void>();
  private readonly history: AgentStreamEvent[] = [];
  private readonly turnDelayMs: number;
  private activeTurn: string | null = null;
  private completionTimer: ReturnType<typeof setTimeout> | null = null;
  private mode = "default";
  private closed = false;

  constructor(
    private readonly config: AgentSessionConfig,
    options: MockSessionOptions = {},
  ) {
    this.turnDelayMs = options.turnDelayMs ?? 5;
  }

  private emit(event: AgentStreamEvent): void {
    this.history.push(event);
    for (const cb of this.subscribers) cb(event);
  }

  subscribe(cb: (event: AgentStreamEvent) => void): Unsubscribe {
    this.subscribers.add(cb);
    return () => this.subscribers.delete(cb);
  }

  async *streamHistory(): AsyncGenerator<AgentStreamEvent> {
    for (const event of this.history) yield event;
  }

  startTurn(prompt: string): Promise<{ turnId: string }> {
    const turnId = randomUUID();
    this.activeTurn = turnId;
    this.emit({ kind: "turn_started", turnId });

    this.completionTimer = setTimeout(() => {
      if (this.activeTurn !== turnId) return;
      this.emit({
        kind: "assistant_message",
        messageId: randomUUID(),
        text: `echo: ${prompt}`,
        final: true,
      });
      this.emit({ kind: "turn_completed", turnId });
      this.activeTurn = null;
      this.completionTimer = null;
    }, this.turnDelayMs);

    return Promise.resolve({ turnId });
  }

  /** Convenience: start a turn and resolve when it reaches a terminal event. */
  run(prompt: string): Promise<void> {
    return new Promise<void>((resolve) => {
      const unsub = this.subscribe((event) => {
        if (
          event.kind === "turn_completed" ||
          event.kind === "turn_failed" ||
          event.kind === "turn_canceled"
        ) {
          unsub();
          resolve();
        }
      });
      void this.startTurn(prompt);
    });
  }

  interrupt(): Promise<void> {
    if (this.activeTurn) {
      if (this.completionTimer) clearTimeout(this.completionTimer);
      const turnId = this.activeTurn;
      this.activeTurn = null;
      this.completionTimer = null;
      this.emit({ kind: "turn_canceled", turnId });
    }
    return Promise.resolve();
  }

  // Steering: queue the message and emit a `queue_update` reflecting the pending queue, mirroring
  // Pi's behavior deterministically for tests. No delivery timing is simulated.
  private readonly steeringQueue: string[] = [];
  private readonly followUpQueue: string[] = [];

  steer(message: string): Promise<void> {
    this.steeringQueue.push(message);
    this.emit({
      kind: "queue_update",
      steering: [...this.steeringQueue],
      followUp: [...this.followUpQueue],
    });
    return Promise.resolve();
  }

  followUp(message: string): Promise<void> {
    this.followUpQueue.push(message);
    this.emit({
      kind: "queue_update",
      steering: [...this.steeringQueue],
      followUp: [...this.followUpQueue],
    });
    return Promise.resolve();
  }

  getRuntimeInfo(): ProviderRuntimeInfo {
    return {
      provider: this.provider,
      sessionId: this.id,
      model: this.config.model ?? "mock-model",
      modeId: this.mode,
      extra: { cwd: this.config.cwd },
    };
  }

  getAvailableModes(): AgentModeDefinition[] {
    return MOCK_MODES;
  }

  getCurrentMode(): string | null {
    return this.mode;
  }

  setMode(id: string): Promise<void> {
    this.mode = id;
    return Promise.resolve();
  }

  getPendingPermissions(): PendingPermission[] {
    return [];
  }

  respondToPermission(): Promise<void> {
    return Promise.resolve();
  }

  describePersistence(): PersistenceHandle | null {
    return { provider: this.provider, sessionId: this.id, nativeHandle: `mock:${this.id}` };
  }

  // Slash-command operations (sprint-037) + command discovery (sprint-040): deterministic,
  // dependency-free implementations for tests. `exportHtml` is deliberately omitted so callers
  // can exercise the unsupported-provider-method → rpc_error path (see slash-command-ops.test.ts);
  // `listCommands` is implemented (below) so that path stays proven by `exportHtml` alone.

  private sessionName: string | undefined;

  getSessionStats(): Promise<{
    sessionId: string;
    totalMessages: number;
    tokens: { total: number };
  }> {
    return Promise.resolve({
      sessionId: this.id,
      totalMessages: this.history.length,
      tokens: { total: 0 },
    });
  }

  compact(): Promise<{ summary: string; firstKeptEntryId: string; tokensBefore: number }> {
    return Promise.resolve({
      summary: "mock compaction summary",
      firstKeptEntryId: "mock-entry-0",
      tokensBefore: 0,
    });
  }

  newSession(): Promise<{ cancelled: boolean }> {
    return Promise.resolve({ cancelled: false });
  }

  switchSession(): Promise<{ cancelled: boolean }> {
    return Promise.resolve({ cancelled: false });
  }

  fork(entryId: string): Promise<{ text: string; cancelled: boolean }> {
    return Promise.resolve({ text: `mock forked text for ${entryId}`, cancelled: false });
  }

  getForkMessages(): Promise<{ entryId: string; text: string }[]> {
    return Promise.resolve([{ entryId: "mock-entry-0", text: "mock first prompt" }]);
  }

  clone(): Promise<{ cancelled: boolean }> {
    return Promise.resolve({ cancelled: false });
  }

  setSessionName(name: string): Promise<void> {
    this.sessionName = name;
    return Promise.resolve();
  }

  cycleModel(): Promise<{ model: { id: string }; thinkingLevel: string }> {
    return Promise.resolve({ model: { id: "mock-model" }, thinkingLevel: "medium" });
  }

  getLastAssistantText(): Promise<string | null> {
    const last = [...this.history].reverse().find((e) => e.kind === "assistant_message");
    return Promise.resolve(last && "text" in last ? (last.text as string) : null);
  }

  /** Command discovery (sprint-040): a deterministic, dependency-free multi-source list — one
   * each of extension/prompt/skill — covering `agent_list_commands_request` without needing a
   * real `pi` binary. */
  listCommands(): Promise<AgentCommandDefinition[]> {
    return Promise.resolve([
      {
        id: "session-name",
        name: "session-name",
        description: "Set or clear session name",
        source: "extension",
        scope: "project",
        path: ".pi/agent/extensions/session.ts",
      },
      {
        id: "fix-tests",
        name: "fix-tests",
        description: "Fix failing tests",
        source: "prompt",
        scope: "project",
        path: ".pi/agent/prompts/fix-tests.md",
      },
      {
        id: "skill:brave-search",
        name: "skill:brave-search",
        description: "Web search via Brave API",
        source: "skill",
        scope: "user",
        path: "~/.pi/agent/skills/brave-search/SKILL.md",
      },
    ]);
  }

  close(): Promise<void> {
    this.closed = true;
    if (this.completionTimer) clearTimeout(this.completionTimer);
    this.completionTimer = null;
    this.activeTurn = null;
    this.subscribers.clear();
    return Promise.resolve();
  }

  isClosed(): boolean {
    return this.closed;
  }
}

export class MockAgentClient implements AgentClient {
  readonly provider = "mock";
  readonly capabilities = MOCK_CAPABILITIES;

  constructor(private readonly options: MockSessionOptions = {}) {}

  createSession(
    config: AgentSessionConfig,
    _launchContext?: LaunchContext,
    _options?: CreateSessionOptions,
  ): Promise<AgentSession> {
    return Promise.resolve(new MockAgentSession(config, this.options));
  }

  resumeSession(
    _handle: PersistenceHandle,
    overrides?: Partial<AgentSessionConfig>,
    launchContext?: LaunchContext,
  ): Promise<AgentSession> {
    const cwd = launchContext?.cwd ?? overrides?.cwd ?? ".";
    return Promise.resolve(
      new MockAgentSession({ provider: "mock", cwd, model: "mock-model" }, this.options),
    );
  }

  listModels(): Promise<AgentModelDefinition[]> {
    return Promise.resolve([{ id: "mock-model", label: "Mock Model" }]);
  }

  listModes(): Promise<AgentModeDefinition[]> {
    return Promise.resolve(MOCK_MODES);
  }

  resolveDefaultModel(): Promise<{ provider?: string; model?: string } | null> {
    return Promise.resolve({ provider: "mock", model: "mock-model" });
  }

  isAvailable(): boolean {
    return true;
  }

  async importSession(args: { providerHandleId: string; cwd: string }): Promise<{
    session: import("../../provider-contract.js").AgentSession;
    persistence: import("../../provider-contract.js").PersistenceHandle;
    timeline: import("@av-pi-studio/protocol").AgentStreamEvent[];
  }> {
    const session = new MockAgentSession({ provider: "mock", cwd: args.cwd }, this.options);
    return {
      session,
      persistence: { provider: "mock", sessionId: session.id, nativeHandle: `mock:${session.id}` },
      timeline: [],
    };
  }
}

/** Factory matching the provider-registry signature `(logger, runtimeSettings, options)`. */
export function createMockClient(options?: MockSessionOptions): MockAgentClient {
  return new MockAgentClient(options);
}
