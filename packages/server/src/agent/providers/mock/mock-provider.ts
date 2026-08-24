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
  ProviderUiRequest,
  ProviderUiResponse,
  Unsubscribe,
} from "../../provider-contract.js";
import { getUiScriptHelpText, parseUiScript, type UiScriptStep } from "./ui-script.js";

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
  supportsExtensionUi: true,
};

const MOCK_MODES: AgentModeDefinition[] = [
  { id: "default", label: "Default" },
  { id: "plan", label: "Plan" },
];
/** Static thinking-level list for the mock provider (sprint-070/task-001) — small enough to
 * exercise clamping in the dev daemon without mirroring Pi's full 7-level ladder. */
const MOCK_THINKING_LEVELS = ["off", "low", "medium", "high"];

export interface MockSessionOptions {
  /** Delay before a started turn completes (ms). Small but non-zero so `interrupt` can win. */
  turnDelayMs?: number;
}

/** Exported so tests (this file's, and downstream sprint-066 task-003/004 daemon-level tests) can
 *  cast a created session to reach `emitUiRequest`/`uiResponses`, which are deliberately not part
 *  of the provider-neutral `AgentSession` contract. */
export class MockAgentSession implements AgentSession {
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
  private thinkingLevel = "off";

  // Extension UI (features/extension-ui-rpc.md, sprint-066): no `pi` process exists to script this
  // family, so the mock provider exposes a scripted emitter (`emitUiRequest`) plus a recorder for
  // `respondToUi` calls, letting tasks 003-004 drive/assert the whole family without a child process.
  private readonly uiSubscribers = new Set<(req: ProviderUiRequest) => void>();
  readonly uiResponses: { providerRequestId: string; response: ProviderUiResponse }[] = [];

  // #ui script support (sprint-068/task-001): a scripted dialog raised via `startTurn` is tracked
  // here so `respondToUi` can resolve the promise `runUiScript` is awaiting, in addition to (not
  // instead of) its existing `uiResponses` recording used by direct `emitUiRequest`/`respondToUi`
  // callers.
  private readonly pendingScriptedResponses = new Map<
    string,
    (response: ProviderUiResponse) => void
  >();

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
    const script = parseUiScript(prompt);
    if (script !== null) return this.startUiScriptTurn(script);

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

  /** `#ui ...` prompt (task-001): raise the scripted dialog(s) through the same `uiSubscribers`
   *  channel `emitUiRequest` uses, instead of the normal echoed turn. Resolves immediately with the
   *  turn id, exactly like the normal path — the dialog(s) and the eventual echo/`turn_completed`
   *  happen asynchronously as `runUiScript` progresses. */
  private startUiScriptTurn(steps: UiScriptStep[]): Promise<{ turnId: string }> {
    const turnId = randomUUID();
    this.activeTurn = turnId;
    this.emit({ kind: "turn_started", turnId });

    if (steps.length === 0) {
      // `#ui help` — no dialog, just the recipe list as assistant text.
      setTimeout(() => {
        if (this.activeTurn !== turnId) return;
        this.emit({
          kind: "assistant_message",
          messageId: randomUUID(),
          text: getUiScriptHelpText(),
          final: true,
        });
        this.emit({ kind: "turn_completed", turnId });
        this.activeTurn = null;
      }, this.turnDelayMs);
      return Promise.resolve({ turnId });
    }

    void this.runUiScript(turnId, steps);
    return Promise.resolve({ turnId });
  }

  private async runUiScript(turnId: string, steps: UiScriptStep[]): Promise<void> {
    const responses = await Promise.all(steps.map((step) => this.raiseScriptedDialog(step)));
    if (this.activeTurn !== turnId) return; // interrupted while dialogs were pending

    for (let i = 0; i < steps.length; i++) {
      const response = responses[i];
      // `null`: a transient step (e.g. `notify`) — fire-and-forget, never resolved, nothing to
      // echo. Only a real answered dialog gets an "ui X resolved: …" line.
      if (response === null || response === undefined) continue;
      this.emit({
        kind: "assistant_message",
        messageId: randomUUID(),
        text: `ui ${steps[i]!.method} resolved: ${describeUiResponse(response)}`,
        final: true,
      });
    }
    this.emit({ kind: "turn_completed", turnId });
    this.activeTurn = null;
  }

  /** Raises one scripted step. A dialog (`expectsResponse: true`) returns a promise that resolves
   *  once `respondToUi` is called for its (mock-minted) `requestId`. A transient
   *  (`expectsResponse: false`, e.g. `notify`) resolves immediately with `null` — it is never
   *  answered, so waiting on `pendingScriptedResponses` for one would hang `runUiScript`'s
   *  `Promise.all` forever. Deliberately separate from the public `emitUiRequest` — that method
   *  fills defaults for ad-hoc test use and tracks nothing. */
  private raiseScriptedDialog(step: UiScriptStep): Promise<ProviderUiResponse | null> {
    const req: ProviderUiRequest = {
      requestId: randomUUID(),
      method: step.method,
      expectsResponse: step.expectsResponse,
      payload: step.payload,
      ...(step.timeoutMs !== undefined ? { timeoutMs: step.timeoutMs } : {}),
    };
    for (const cb of this.uiSubscribers) cb(req);
    if (!step.expectsResponse) return Promise.resolve(null);
    const { promise, resolve } = Promise.withResolvers<ProviderUiResponse>();
    this.pendingScriptedResponses.set(req.requestId, resolve);
    return promise;
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
      thinkingLevel: this.thinkingLevel,
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

  /** Sprint-070/task-001: store the level clamped to the mock's static list, mirroring Pi's
   * silent clamping so the dev daemon exercises the same effective-level semantics. */
  setThinkingOption(id: string): Promise<void> {
    this.thinkingLevel = MOCK_THINKING_LEVELS.includes(id) ? id : "off";
    return Promise.resolve();
  }

  listThinkingLevels(): Promise<string[]> {
    return Promise.resolve([...MOCK_THINKING_LEVELS]);
  }

  getPendingPermissions(): PendingPermission[] {
    return [];
  }

  respondToPermission(): Promise<void> {
    return Promise.resolve();
  }

  onUiRequest(cb: (req: ProviderUiRequest) => void): Unsubscribe {
    this.uiSubscribers.add(cb);
    return () => this.uiSubscribers.delete(cb);
  }

  respondToUi(providerRequestId: string, response: ProviderUiResponse): void {
    this.uiResponses.push({ providerRequestId, response });
    const resolve = this.pendingScriptedResponses.get(providerRequestId);
    if (resolve) {
      this.pendingScriptedResponses.delete(providerRequestId);
      resolve(response);
    }
  }

  /** Test-only: push a scripted UI request to every subscriber, with sensible defaults for any
   *  field the caller omits. Returns the request actually emitted (its `requestId` in particular),
   *  so a test can answer it via `respondToUi` or assert against it directly. */
  emitUiRequest(partial: Partial<ProviderUiRequest> = {}): ProviderUiRequest {
    const req: ProviderUiRequest = {
      requestId: partial.requestId ?? randomUUID(),
      method: partial.method ?? "confirm",
      expectsResponse: partial.expectsResponse ?? true,
      payload: partial.payload ?? {},
      ...(partial.surfaceKey !== undefined ? { surfaceKey: partial.surfaceKey } : {}),
      ...(partial.removed !== undefined ? { removed: partial.removed } : {}),
      ...(partial.timeoutMs !== undefined ? { timeoutMs: partial.timeoutMs } : {}),
    };
    for (const cb of this.uiSubscribers) cb(req);
    return req;
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
    return Promise.resolve({ model: { id: "mock-model" }, thinkingLevel: this.thinkingLevel });
  }

  getLastAssistantText(): Promise<string | null> {
    const last = [...this.history].toReversed().find((e) => e.kind === "assistant_message");
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
    return Promise.resolve([
      {
        id: "mock-model",
        label: "Mock Model",
        reasoning: true,
        thinkingLevels: [...MOCK_THINKING_LEVELS],
      },
    ]);
  }

  listModes(): Promise<AgentModeDefinition[]> {
    return Promise.resolve(MOCK_MODES);
  }

  resolveDefaultModel(): Promise<{
    provider?: string;
    model?: string;
    thinkingLevel?: string;
  } | null> {
    return Promise.resolve({ provider: "mock", model: "mock-model", thinkingLevel: "off" });
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

/** Renders a scripted dialog's answer as short, human-readable assistant text (task-001: "the mock
 *  echoes what it received"). Dev/test-only tooling — unlike the web-client's presentation rules
 *  (sprint-068/task-004), this deliberately may name a typed value, since it exists to prove the
 *  round trip during manual verification. */
function describeUiResponse(response: ProviderUiResponse): string {
  if (response.cancelled) return "cancelled: true";
  if (response.confirmed !== undefined) return `confirmed: ${response.confirmed}`;
  if (response.value !== undefined) return `value: ${JSON.stringify(response.value)}`;
  return "no answer";
}
