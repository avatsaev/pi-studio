import { randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import type {
  AgentCapabilityFlags,
  AgentSessionConfig,
  AgentStreamEvent,
} from "@av-pi-studio/protocol";

import type {
  AgentClient,
  AgentCommandDefinition,
  AgentCompactResult,
  AgentCycleModelResult,
  AgentForkMessage,
  AgentModeDefinition,
  AgentModelDefinition,
  AgentSession,
  AgentSessionStats,
  CreateSessionOptions,
  ImportableSessionRow,
  ImportSessionArgs,
  ImportSessionResult,
  LaunchContext,
  PendingPermission,
  PersistenceHandle,
  ProviderRuntimeInfo,
  RunOptions,
  Unsubscribe,
} from "../../provider-contract.js";
import type { TimelineRow } from "../../timeline-store.js";
import { createPiEventMapper } from "./event-mapper.js";
import { hydrateTimelineFromSessionFile } from "./session-hydration.js";
import {
  createProcessTransport,
  defaultPiCommand,
  type PiRpcTransport,
  type PiTransportFactory,
  resolveBinaryOnPath,
} from "./rpc-transport.js";

/**
 * Pi provider adapter (features/agent-providers.md § Pi lifecycle / § Models·modes·features /
 * § Import & resume). Spawns `pi --mode rpc` (or a configured `command`), maps RPC events to
 * `AgentStreamEvent`s, passes Pi-Studio system prompts via `--append-system-prompt` (preserving Pi's
 * default prompt), and discovers models/modes via top-level RPC calls (never a scratch session).
 */

export const PI_CAPABILITIES: AgentCapabilityFlags = {
  supportsStreaming: true,
  supportsSessionPersistence: true,
  supportsDynamicModes: true,
  supportsMcpServers: true,
  supportsReasoningStream: true,
  supportsToolInvocations: true,
  supportsSteering: true,
};

export interface PiClientDeps {
  /** Provider id (custom `extends:"pi"` profiles reuse this adapter with their own id). */
  provider?: string;
  /** Launch command; defaults to `pi --mode rpc`. */
  command?: string[];
  env?: Record<string, string>;
  /** JSONL session directory for import discovery (`params.sessionDir` for forks). */
  sessionDir?: string;
  /** System prompt appended to every session (preserves Pi's default prompt). */
  appendSystemPrompt?: string;
  /** Injected for tests; defaults to the real process transport. */
  transportFactory?: PiTransportFactory;
  /** Injected for tests; defaults to a `$PATH` scan. */
  binaryResolver?: (bin: string, env?: Record<string, string | undefined>) => boolean;
  /** Operational logger, forwarded to every spawned `pi` process transport. */
  logger?: Pick<Console, "info" | "warn" | "error">;
}

export interface PiSessionLaunch {
  args: string[];
  cwd: string;
  env: Record<string, string>;
  sessionFile?: string;
}

/** Build Pi argv, appending (never replacing) the system prompt and optional `--mcp-config`. */
export function buildPiArgs(
  base: string[],
  opts: { appendSystemPrompt?: string; mcpConfigPath?: string },
): string[] {
  const args = [...base];
  if (opts.appendSystemPrompt) args.push("--append-system-prompt", opts.appendSystemPrompt);
  if (opts.mcpConfigPath) args.push("--mcp-config", opts.mcpConfigPath);
  return args;
}

/** Extract a usable model identifier from a Pi `Model` object (`{id, name, api, provider}`,
 * docs/rpc.md § Model) or `null`/`undefined`. Prefers `id` (the wire-stable identifier); falls
 * back to `name` (display label) if `id` is somehow absent. */
function modelIdFrom(model: unknown): string | undefined {
  if (!model || typeof model !== "object") return undefined;
  const rec = model as Record<string, unknown>;
  if (typeof rec.id === "string") return rec.id;
  if (typeof rec.name === "string") return rec.name;
  return undefined;
}

class PiAgentSession implements AgentSession {
  readonly provider: string;
  readonly id = randomUUID();
  readonly capabilities = PI_CAPABILITIES;

  private readonly subscribers = new Set<(event: AgentStreamEvent) => void>();
  private readonly history: AgentStreamEvent[] = [];
  private readonly eventMapper = createPiEventMapper();
  private modes: AgentModeDefinition[] = [];
  private mode: string | null;
  private model: string | undefined;
  private sessionFile?: string;

  constructor(
    private readonly transport: PiRpcTransport,
    opts: { provider: string; config: AgentSessionConfig; sessionFile?: string },
  ) {
    this.provider = opts.provider;
    this.mode = opts.config.modeId ?? null;
    this.sessionFile = opts.sessionFile;
    transport.onEvent((raw) => {
      // Auto-respond to extension UI dialogs so the agent never blocks waiting on a client that
      // isn't wired for them (POC). Safe default: cancel (extension receives undefined/false).
      const rec = raw as Record<string, unknown>;
      if (rec?.type === "extension_ui_request") {
        const method = rec.method as string | undefined;
        if (
          method === "select" ||
          method === "confirm" ||
          method === "input" ||
          method === "editor"
        ) {
          this.transport.notify("extension_ui_response", { id: rec.id as string, cancelled: true });
        }
        return;
      }
      const event = this.eventMapper.map(raw);
      if (event) this.emit(event);
    });
  }

  private emit(event: AgentStreamEvent): void {
    this.history.push(event);
    for (const cb of this.subscribers) cb(event);
  }

  setDiscoveredModes(modes: AgentModeDefinition[]): void {
    this.modes = modes;
  }

  /**
   * Learn state Pi already knows about THIS process via `get_state` (docs/rpc.md § get_state):
   * the JSONL session file it picked (`sessionFile`) and its current model (`model`).
   *
   * `sessionFile`: a freshly spawned `createSession` never sets it at construction (only resume/
   * import do, since they choose the file up front) — without this, `describePersistence()` would
   * return no `nativeHandle` and a plain restart could never find the conversation Pi already
   * wrote to disk.
   *
   * `model`: the Pi provider otherwise never tracks its own current model at all —
   * `AgentSessionConfig.model` isn't consulted at spawn (Pi resolves its own default/persisted
   * model), and `getRuntimeInfo()` is a synchronous contract method, so it cannot make its own RPC
   * call. Without this, `getRuntimeInfo().model` would always be `undefined`, leaving both
   * `list_agents` (sprint-042/task-001) and the session-stats poll's runtime-info fallback
   * (sprint-042/task-002) with nothing to report for the ONLY provider used in production (the
   * mock provider always has a model, which is why this gap wasn't caught by unit tests — only a
   * live smoke test against a real `pi` process surfaced it).
   *
   * Best-effort: a request failure leaves both fields exactly as they were (unset for a fresh
   * session), which is a legitimate state, not an error.
   */
  async discoverState(): Promise<void> {
    try {
      const state = (await this.transport.request("get_state")) as Record<string, unknown>;
      // Never clobber an already-known sessionFile (resume/import chose it up front and already
      // `switchSession()`ed to it) — only a fresh, never-anchored session learns it here.
      if (!this.sessionFile && typeof state.sessionFile === "string") {
        this.sessionFile = state.sessionFile;
      }
      const modelId = modelIdFrom(state.model);
      if (modelId) this.model = modelId;
    } catch {
      /* best-effort */
    }
  }

  subscribe(cb: (event: AgentStreamEvent) => void): Unsubscribe {
    this.subscribers.add(cb);
    return () => this.subscribers.delete(cb);
  }

  async *streamHistory(): AsyncGenerator<AgentStreamEvent> {
    for (const event of this.history) yield event;
  }

  /**
   * Convert client `{mimeType, data}` attachments to Pi's `ImageContent` shape
   * (`{type:"image", data, mimeType}`, docs/rpc.md). Shared by `prompt`, `steer`, `follow_up`.
   */
  private toPiImages(
    images: RunOptions["images"],
  ): { type: "image"; data: string; mimeType: string }[] | undefined {
    const mapped = images
      ?.map((img) => {
        const rec = img as Record<string, unknown>;
        const data = typeof rec.data === "string" ? rec.data : undefined;
        const mimeType = typeof rec.mimeType === "string" ? rec.mimeType : undefined;
        return data && mimeType ? { type: "image" as const, data, mimeType } : undefined;
      })
      .filter((img): img is { type: "image"; data: string; mimeType: string } => img !== undefined);
    return mapped && mapped.length > 0 ? mapped : undefined;
  }

  startTurn(prompt: string, opts?: RunOptions): Promise<{ turnId: string }> {
    const turnId = randomUUID();
    // Pi RPC `prompt` command (docs/rpc.md): `{type:"prompt", message, images?}`.
    const images = this.toPiImages(opts?.images);
    this.transport.notify("prompt", { message: prompt, ...(images ? { images } : {}) });
    return Promise.resolve({ turnId });
  }

  run(prompt: string, opts?: RunOptions): Promise<void> {
    // A prompt starting with `/` may be an extension command, which Pi runs inline and emits NO
    // turn lifecycle for (dist/core/agent-session.js `prompt()` returns right after
    // `_tryExecuteExtensionCommand`) — awaiting a terminal event for one hangs the turn, and with
    // it the agent's `running` status, forever. Those go through `runSlashPrompt`.
    if (prompt.startsWith("/")) return this.runSlashPrompt(prompt, opts);
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
      void this.startTurn(prompt, opts);
    });
  }

  /**
   * Send a `/command` prompt *correlated* (`request`, not `notify`) so Pi's own ack is observable:
   * Pi acks on preflight (dist/modes/rpc/rpc-mode.js `case "prompt"`), then `get_state.isStreaming`
   * — set synchronously as `_runAgentPrompt`'s first statement, hence already `true` for a real
   * turn by the time the ack reaches us — says whether a turn is actually running. Not streaming ⇒
   * the command was handled inline (extension command) and this turn is already over. A rejected
   * ack (no model, no auth, "Agent is already processing") now surfaces as a failed turn instead of
   * being silently dropped the way an unmatched `notify` response is (rpc-transport.ts `handleLine`).
   */
  private async runSlashPrompt(prompt: string, opts?: RunOptions): Promise<void> {
    let terminated = false;
    let onTerminal: (() => void) | undefined;
    const terminal = new Promise<void>((resolve) => {
      onTerminal = resolve;
    });
    const unsub = this.subscribe((event) => {
      if (
        event.kind === "turn_completed" ||
        event.kind === "turn_failed" ||
        event.kind === "turn_canceled"
      ) {
        terminated = true;
        onTerminal?.();
      }
    });
    try {
      const images = this.toPiImages(opts?.images);
      await this.transport.request("prompt", {
        message: prompt,
        ...(images ? { images } : {}),
      });
      if (terminated) return;
      const state = (await this.transport.request("get_state")) as { isStreaming?: boolean };
      if (state.isStreaming === false) return;
      await terminal;
    } finally {
      unsub();
    }
  }

  getRuntimeInfo(): ProviderRuntimeInfo {
    return {
      provider: this.provider,
      sessionId: this.id,
      modeId: this.mode ?? undefined,
      model: this.model,
    };
  }

  getAvailableModes(): AgentModeDefinition[] {
    return this.modes;
  }

  getCurrentMode(): string | null {
    return this.mode;
  }

  async setMode(id: string): Promise<void> {
    // Pi RPC has no `set_mode` command (modes are a Pi-Studio concept layered over the provider).
    // Track it locally; model/thinking changes go through setModel/setThinkingOption.
    this.mode = id;
    return Promise.resolve();
  }

  getPendingPermissions(): PendingPermission[] {
    return [];
  }

  respondToPermission(requestId: string, response: unknown): Promise<void> {
    this.transport.notify("respond_to_permission", { requestId, response });
    return Promise.resolve();
  }

  describePersistence(): PersistenceHandle | null {
    return {
      provider: this.provider,
      sessionId: this.id,
      ...(this.sessionFile ? { nativeHandle: this.sessionFile } : {}),
    };
  }

  interrupt(): Promise<void> {
    this.transport.notify("abort", {});
    return Promise.resolve();
  }

  // Steering (docs/rpc.md `steer`/`follow_up`): fire-and-forget like `abort`. Injected into a live
  // turn; delivery is reported asynchronously via the `queue_update` event, not a response.
  steer(message: string, opts?: { images?: RunOptions["images"] }): Promise<void> {
    const images = this.toPiImages(opts?.images);
    this.transport.notify("steer", { message, ...(images ? { images } : {}) });
    return Promise.resolve();
  }

  followUp(message: string, opts?: { images?: RunOptions["images"] }): Promise<void> {
    const images = this.toPiImages(opts?.images);
    this.transport.notify("follow_up", { message, ...(images ? { images } : {}) });
    return Promise.resolve();
  }

  // Slash-command operations (sprint-037): request/response Pi RPC commands, not fire-and-forget
  // like `prompt`/`abort`. Response `data` is mapped into the provider-neutral result shape.

  async getSessionStats(): Promise<AgentSessionStats> {
    const data = (await this.transport.request("get_session_stats")) as AgentSessionStats;
    return data ?? {};
  }

  async compact(customInstructions?: string): Promise<AgentCompactResult> {
    const params = customInstructions ? { customInstructions } : {};
    const data = (await this.transport.request("compact", params)) as AgentCompactResult;
    return data ?? {};
  }

  /**
   * Re-read the JSONL file Pi is writing to now. `new_session`/`switch_session`/`fork`/`clone` all
   * REBIND the process to a different session file (Pi's `agent-session-runtime` builds a fresh
   * `SessionManager` for each), so the file learned at spawn is stale the instant one succeeds.
   * That matters beyond bookkeeping: `describePersistence()`'s `nativeHandle` is what a restarted
   * daemon rehydrates the timeline from (`session-hydration.ts`) and resumes the process into — a
   * stale one silently restores the pre-operation conversation while the live agent remembers the
   * newer one. Unlike `discoverState()`, this deliberately overwrites the known file.
   */
  private async refreshSessionFile(): Promise<void> {
    try {
      const state = (await this.transport.request("get_state")) as Record<string, unknown>;
      if (typeof state.sessionFile === "string") this.sessionFile = state.sessionFile;
    } catch {
      /* best-effort: keep the previous handle rather than dropping it */
    }
  }

  async newSession(): Promise<{ cancelled: boolean }> {
    const data = (await this.transport.request("new_session")) as { cancelled?: boolean };
    const cancelled = data?.cancelled ?? false;
    if (!cancelled) await this.refreshSessionFile();
    return { cancelled };
  }

  async switchSession(sessionPath: string): Promise<{ cancelled: boolean }> {
    const data = (await this.transport.request("switch_session", { sessionPath })) as {
      cancelled?: boolean;
    };
    const cancelled = data?.cancelled ?? false;
    if (!cancelled) await this.refreshSessionFile();
    return { cancelled };
  }

  async fork(entryId: string): Promise<{ text: string; cancelled: boolean }> {
    const data = (await this.transport.request("fork", { entryId })) as {
      text?: string;
      cancelled?: boolean;
    };
    const cancelled = data?.cancelled ?? false;
    if (!cancelled) await this.refreshSessionFile();
    return { text: data?.text ?? "", cancelled };
  }

  async getForkMessages(): Promise<AgentForkMessage[]> {
    const data = (await this.transport.request("get_fork_messages")) as {
      messages?: AgentForkMessage[];
    };
    return Array.isArray(data?.messages) ? data.messages : [];
  }

  async clone(): Promise<{ cancelled: boolean }> {
    const data = (await this.transport.request("clone")) as { cancelled?: boolean };
    const cancelled = data?.cancelled ?? false;
    if (!cancelled) await this.refreshSessionFile();
    return { cancelled };
  }

  async setSessionName(name: string): Promise<void> {
    await this.transport.request("set_session_name", { name });
  }

  async exportHtml(outputPath?: string): Promise<{ path: string }> {
    const params = outputPath ? { outputPath } : {};
    const data = (await this.transport.request("export_html", params)) as { path?: string };
    return { path: data?.path ?? "" };
  }

  async setProviderModel(provider: string, modelId: string): Promise<unknown> {
    const data = await this.transport.request("set_model", { provider, modelId });
    const resolved = modelIdFrom(data);
    if (resolved) this.model = resolved;
    return data;
  }

  async cycleModel(): Promise<AgentCycleModelResult> {
    const data = (await this.transport.request("cycle_model")) as AgentCycleModelResult;
    const resolved = modelIdFrom(data?.model);
    if (resolved) this.model = resolved;
    return data ?? {};
  }

  async getLastAssistantText(): Promise<string | null> {
    const data = (await this.transport.request("get_last_assistant_text")) as {
      text?: string | null;
    };
    return data?.text ?? null;
  }

  /** `get_commands` (docs/rpc.md § get_commands) — extension/prompt/skill discovery. */
  async listCommands(): Promise<AgentCommandDefinition[]> {
    const data = (await this.transport.request("get_commands")) as {
      commands?: Array<{
        name: string;
        description?: string;
        source?: "extension" | "prompt" | "skill";
        sourceInfo?: { scope?: "user" | "project" | "temporary"; path?: string };
      }>;
    };
    if (!Array.isArray(data?.commands)) return [];
    return data.commands.map((cmd) => ({
      id: cmd.name,
      name: cmd.name,
      description: cmd.description,
      source: cmd.source,
      scope: cmd.sourceInfo?.scope,
      path: cmd.sourceInfo?.path,
    }));
  }

  close(): Promise<void> {
    this.subscribers.clear();
    return this.transport.close();
  }
}

export class PiAgentClient implements AgentClient {
  readonly provider: string;
  readonly capabilities = PI_CAPABILITIES;
  private readonly command: string[];
  private readonly factory: PiTransportFactory;
  private readonly resolver: (bin: string, env?: Record<string, string | undefined>) => boolean;

  constructor(private readonly deps: PiClientDeps = {}) {
    this.provider = deps.provider ?? "pi";
    this.command = deps.command ?? defaultPiCommand();
    this.factory = deps.transportFactory ?? createProcessTransport;
    this.resolver = deps.binaryResolver ?? resolveBinaryOnPath;
  }

  isAvailable(): boolean {
    return this.resolver(this.command[0] as string, this.deps.env);
  }

  /** Build a clear error when the Pi binary cannot be resolved (avoids a raw spawn ENOENT). */
  private unavailableError(): Error {
    return new Error(
      `Pi provider unavailable: '${this.command[0] as string}' was not found on PATH. ` +
        `Install the Pi CLI, ensure it is on the daemon's PATH, or set ` +
        `agents.providers.pi.command to its absolute path in config.json. ` +
        `(Or use the 'mock' provider for a dependency-free test.)`,
    );
  }

  private buildEnv(
    launchContext?: LaunchContext,
    options?: CreateSessionOptions,
  ): Record<string, string> {
    return { ...this.deps.env, ...launchContext?.env, ...options?.env };
  }

  // NOTE: create and resume must stay in agreement on how systemPrompt is handled; see task-005.
  async createSession(
    config: AgentSessionConfig,
    launchContext?: LaunchContext,
    options?: CreateSessionOptions,
  ): Promise<AgentSession> {
    if (!this.isAvailable()) return Promise.reject(this.unavailableError());
    const args = buildPiArgs(this.command, {
      appendSystemPrompt: config.systemPrompt ?? this.deps.appendSystemPrompt,
    });
    const transport = this.factory({
      args,
      cwd: launchContext?.cwd ?? config.cwd,
      env: this.buildEnv(launchContext, options),
      logger: this.deps.logger,
    });
    const session = new PiAgentSession(transport, { provider: this.provider, config });
    // Learn the JSONL file Pi picked for this fresh process (so `describePersistence()` can hand
    // back a `nativeHandle` a restarted daemon can later rehydrate the timeline from) and its
    // current model (sprint-042 — see `discoverState`'s doc comment for why).
    await session.discoverState();
    return session;
  }

  /**
   * Resume a persisted session by spawning a FRESH `pi --mode rpc` process and loading `handle`'s
   * JSONL file into it via `switch_session` (docs/rpc.md § switch_session — "Load a different
   * session file"). RPC mode has no CLI flag to preload a session at spawn (`--session <path>` is
   * a TUI-only flag per docs/usage.md, absent from rpc.md's own "Common options"), so a freshly
   * spawned process always starts on its own new/default session with zero history — without this
   * call the resumed session is conversationally empty. The daemon's *own* record/timeline still
   * shows the full prior conversation in the UI (that's fetched separately from
   * `agents/**.json`/the timeline store), which is what made this bug easy to miss: the UI looked
   * fine right up until the next prompt, which then got no prior context at all. `importSession`
   * shares this exact path and was equally affected.
   * NOTE: create and resume must stay in agreement on how systemPrompt is handled; see task-005.
   */
  async resumeSession(
    handle: PersistenceHandle,
    overrides?: Partial<AgentSessionConfig>,
    launchContext?: LaunchContext,
  ): Promise<AgentSession> {
    if (!this.isAvailable()) return Promise.reject(this.unavailableError());
    const sessionFile = typeof handle.nativeHandle === "string" ? handle.nativeHandle : undefined;
    const cwd = launchContext?.cwd ?? overrides?.cwd ?? ".";
    const transport = this.factory({
      args: buildPiArgs(this.command, {
        appendSystemPrompt: overrides?.systemPrompt ?? this.deps.appendSystemPrompt,
      }),
      cwd,
      env: this.buildEnv(launchContext),
      sessionFile,
      logger: this.deps.logger,
    });
    const session = new PiAgentSession(transport, {
      provider: this.provider,
      config: { provider: this.provider, cwd, ...overrides },
      sessionFile,
    });
    if (sessionFile) await session.switchSession(sessionFile);
    // Learn the resumed process's current model (sprint-042 — a fresh `pi --mode rpc` process has
    // no local model state until asked; see `discoverState`'s doc comment).
    await session.discoverState();
    return session;
  }

  /**
   * Discover models via the Pi RPC `get_available_models` command (no scratch session). Each raw
   * entry is Pi's full `Model` object (docs/rpc.md § Model) — carries its own `provider` (the
   * underlying LLM provider, e.g. `"anthropic"`), which is REQUIRED to call `set_model` back
   * (sprint-043: dropping this field here caused every `agent_set_model_request` to fail with
   * "Model not found: pi/<modelId>" — "pi" is the pi-studio `AgentClient` id, never a real LLM
   * provider Pi recognizes).
   */
  async listModels(opts?: { cwd?: string }): Promise<AgentModelDefinition[]> {
    const data = await this.topLevel("get_available_models", opts?.cwd);
    const raw = (data as Record<string, unknown>)?.models;
    const models = Array.isArray(raw) ? raw : [];
    return models.map((m) => {
      const rec = m as Record<string, unknown>;
      return {
        id: String(rec.id ?? rec.name ?? ""),
        label: typeof rec.name === "string" ? rec.name : String(rec.id ?? ""),
        provider: typeof rec.provider === "string" ? rec.provider : undefined,
      } as AgentModelDefinition;
    });
  }

  /** Pi RPC has no `list_modes`; modes come from the provider manifest, not the process. */
  listModes(): Promise<AgentModeDefinition[]> {
    return Promise.resolve([]);
  }

  /**
   * Resolve the model a brand-new session would run on with no `--model`/`--provider` override:
   * settings.json `defaultModel`/`defaultProvider`, else Pi's built-in default (docs/settings.md
   * § Global settings, docs/rpc.md § get_state). Spawns a transient `pi --mode rpc --no-session`
   * process (`--no-session`: docs/rpc.md's own common-options list, "Disable session
   * persistence") purely to ask `get_state`, then closes it — `--no-session` guarantees this never
   * leaves a scratch JSONL file, the exact risk `listModels`'s doc comment above flags for
   * spawning a session-anchored process just to read metadata. Display-only: the result is never
   * itself persisted or replayed — see `AgentClient.resolveDefaultModel`'s doc comment.
   */
  async resolveDefaultModel(opts?: {
    cwd?: string;
  }): Promise<{ provider?: string; model?: string } | null> {
    const data = (await this.topLevel("get_state", opts?.cwd, { noSession: true })) as
      | Record<string, unknown>
      | undefined;
    const rec = data?.model as Record<string, unknown> | undefined;
    if (!rec) return null;
    return {
      provider: typeof rec.provider === "string" ? rec.provider : undefined,
      model: modelIdFrom(rec),
    };
  }

  private async topLevel(
    command: string,
    cwd?: string,
    opts?: { noSession?: boolean },
  ): Promise<unknown> {
    if (!this.isAvailable()) throw this.unavailableError();
    const args = buildPiArgs(this.command, { appendSystemPrompt: this.deps.appendSystemPrompt });
    if (opts?.noSession) args.push("--no-session");
    const transport = this.factory({
      args,
      cwd: cwd ?? ".",
      env: this.buildEnv(),
      logger: this.deps.logger,
    });
    try {
      return await transport.request(command);
    } finally {
      await transport.close();
    }
  }

  /** Enumerate Pi JSONL session files for the import picker (rows only). */
  listImportableSessions(opts?: { cwd?: string }): Promise<ImportableSessionRow[]> {
    const dir = this.deps.sessionDir;
    if (!dir || !existsSync(dir)) return Promise.resolve([]);

    const rows: ImportableSessionRow[] = [];
    for (const file of readdirSync(dir)) {
      if (!file.endsWith(".jsonl")) continue;
      const full = join(dir, file);
      let cwd = "";
      let title: string | undefined;
      let promptPreview: string | undefined;
      try {
        const firstLine = readFileSync(full, "utf8")
          .split("\n")
          .find((l) => l.trim());
        if (firstLine) {
          const head = JSON.parse(firstLine) as Record<string, unknown>;
          cwd = typeof head.cwd === "string" ? head.cwd : "";
          title = typeof head.title === "string" ? head.title : undefined;
          promptPreview = typeof head.prompt === "string" ? head.prompt : undefined;
        }
      } catch {
        // best-effort metadata; the row is still importable
      }
      if (opts?.cwd && cwd && cwd !== opts.cwd) continue;
      rows.push({
        providerHandleId: full,
        cwd,
        title,
        promptPreview,
        lastActivityAt: statSync(full).mtime.toISOString(),
      });
    }
    return Promise.resolve(rows);
  }

  /** Resume one native session (the JSONL file is the `nativeHandle`) and return a hydrated result. */
  async importSession(args: ImportSessionArgs): Promise<ImportSessionResult> {
    const session = await this.resumeSession(
      { provider: this.provider, nativeHandle: args.providerHandleId },
      { cwd: args.cwd },
      { cwd: args.cwd },
    );
    const persistence = session.describePersistence() as PersistenceHandle;
    return {
      session,
      persistence,
      timeline: this.hydrateTimeline(persistence).map((row) => row.event),
    };
  }

  /** Rebuild a timeline by reading Pi's own on-disk JSONL session file (no live process needed). */
  hydrateTimeline(handle: PersistenceHandle): TimelineRow[] {
    const sessionFile = typeof handle.nativeHandle === "string" ? handle.nativeHandle : undefined;
    if (!sessionFile) return [];
    return hydrateTimelineFromSessionFile(sessionFile);
  }
}

/** Factory matching the provider-registry signature. */
export function createPiClient(deps: PiClientDeps = {}): PiAgentClient {
  return new PiAgentClient(deps);
}
