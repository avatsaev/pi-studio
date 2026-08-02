import type { DaemonClient } from "@av-pi-studio/client";
import type { AgentStreamEvent } from "@av-pi-studio/protocol";
import type { Command } from "commander";

import {
  type CliContext,
  type GlobalOptions,
  EXIT_ERROR,
  EXIT_OK,
  withDaemon,
} from "./cli-core.js";
import { renderJson, renderObject, renderTable } from "./output.js";

/**
 * Agent command group (features/cli.md § Command tree (agent); agent-sessions.md § Other
 * operations). Each command maps to the same WS RPC as its app/MCP equivalent.
 *
 * RPC names follow the daemon's registered handlers where they exist (`create_agent_request`,
 * `send_agent_prompt`, `interrupt_agent`, `update_agent`, `resume_agent`, `import_agent_session`,
 * `fetch_agent_timeline_request`). Names for operations whose daemon handlers land in other sprints
 * (`list_agents_request`, `archive_agent`, `delete_agent`, `inspect_agent_request`,
 * `wait_for_agent`) are the canonical names per the scope and are flagged TODO(verify).
 */

export const AGENT_RPC = {
  create: "create_agent_request",
  send: "send_agent_prompt",
  stop: "interrupt_agent",
  steer: "steer_agent_request",
  followUp: "follow_up_agent_request",
  update: "update_agent",
  resume: "resume_agent",
  import: "import_agent_session",
  timeline: "fetch_agent_timeline_request",
  // TODO(verify): daemon handlers for these land in later/integration sprints.
  list: "list_agents_request",
  archive: "archive_agent",
  delete: "delete_agent",
  inspect: "inspect_agent_request",
  wait: "wait_for_agent",
  // Slash-command operations (sprint-037): Pi built-ins with a real Pi RPC equivalent — daemon
  // handlers registered in packages/server/src/agent/slash-command-operations.ts.
  sessionStats: "agent_session_stats_request",
  compact: "agent_compact_request",
  newSession: "agent_new_session_request",
  switchSession: "agent_switch_session_request",
  fork: "agent_fork_request",
  forkMessages: "agent_fork_messages_request",
  clone: "agent_clone_request",
  setSessionName: "agent_set_session_name_request",
  exportHtml: "agent_export_html_request",
  setModel: "agent_set_model_request",
  cycleModel: "agent_cycle_model_request",
  lastAssistantText: "agent_last_assistant_text_request",
  // Command discovery (sprint-040): user/project-authored commands surfaced from Pi's
  // `get_commands` — extension commands, prompt templates, and skills.
  listCommands: "agent_list_commands_request",
} as const;

/** Parse a `--provider pi/<model>` spec into provider id + optional model. */
export function parseProviderModel(spec?: string): { provider: string; model?: string } {
  if (!spec || !spec.trim()) return { provider: "pi" };
  const trimmed = spec.trim();
  const slash = trimmed.indexOf("/");
  if (slash === -1) return { provider: trimmed };
  return { provider: trimmed.slice(0, slash), model: trimmed.slice(slash + 1) || undefined };
}

/** Render one timeline/stream event as a single line. */
export function formatStreamEvent(event: AgentStreamEvent): string {
  switch (event.kind) {
    case "user_message":
      return `» ${event.text ?? ""}`;
    case "assistant_message":
      return `${event.text ?? ""}`;
    case "reasoning":
      return `· ${event.text ?? ""}`;
    case "tool_call": {
      const t = event.tool;
      const detail =
        ("command" in t && t.command) ||
        ("path" in t && t.path) ||
        ("query" in t && t.query) ||
        ("url" in t && t.url) ||
        ("description" in t && t.description) ||
        "";
      return `[${t.kind}${event.status ? ` ${event.status}` : ""}] ${detail}`;
    }
    case "turn_started":
      return `--- turn started ---`;
    case "turn_completed":
      return `--- turn completed ---`;
    case "turn_failed":
      return `--- turn failed: ${event.error ?? ""} ---`;
    case "turn_canceled":
      return `--- turn canceled ---`;
    case "error":
      return `!! ${event.message ?? "error"}`;
    case "queue_update": {
      const parts: string[] = [];
      if (event.steering && event.steering.length > 0) {
        parts.push(`steering: ${event.steering.join(" | ")}`);
      }
      if (event.followUp && event.followUp.length > 0) {
        parts.push(`follow-up: ${event.followUp.join(" | ")}`);
      }
      return `~ queue [${parts.join("; ") || "empty"}]`;
    }
    default:
      return JSON.stringify(event);
  }
}

const isTerminalEvent = (e: AgentStreamEvent): boolean =>
  e.kind === "turn_completed" || e.kind === "turn_failed" || e.kind === "turn_canceled";

// ─── Pure command actions (run inside withDaemon) ───────────────────────────────

export interface RunOptions {
  provider?: string;
  worktree?: string;
  cwd?: string;
  json?: boolean;
}

/** `run` — create + run an agent, print its id. */
export async function runAgent(
  client: DaemonClient,
  ctx: CliContext,
  prompt: string,
  opts: RunOptions,
): Promise<number> {
  const { provider, model } = parseProviderModel(opts.provider);
  const config: Record<string, unknown> = { provider, cwd: opts.cwd ?? process.cwd() };
  if (model) config.model = model;
  const params: Record<string, unknown> = { config, initialPrompt: prompt };
  if (opts.worktree) params.worktreeName = opts.worktree;

  const payload = await client.request<{ agentId: string }>(AGENT_RPC.create, params);
  ctx.sink.write(opts.json ? renderJson(payload) : payload.agentId);
  return EXIT_OK;
}

export interface LsOptions {
  all?: boolean;
  global?: boolean;
  json?: boolean;
}

/** `ls` — list agents. `-a` all, `-g` global. */
export async function lsAgents(
  client: DaemonClient,
  ctx: CliContext,
  opts: LsOptions,
): Promise<number> {
  const payload = await client.request<{ agents?: Array<Record<string, unknown>> }>(
    AGENT_RPC.list,
    {
      all: Boolean(opts.all),
      global: Boolean(opts.global),
    },
  );
  const agents = payload.agents ?? [];
  ctx.sink.write(
    opts.json
      ? renderJson(payload)
      : renderTable(agents, ["agentId", "status", "provider", "title"]),
  );
  return EXIT_OK;
}

/** `send` — send a follow-up prompt. */
export async function sendAgent(
  client: DaemonClient,
  ctx: CliContext,
  agentId: string,
  prompt: string,
  opts: GlobalOptions,
): Promise<number> {
  const payload = await client.request(AGENT_RPC.send, { agentId, prompt });
  ctx.sink.write(opts.json ? renderJson(payload) : "sent");
  return EXIT_OK;
}

/** `steer` / `follow-up` — inject a message into a LIVE turn (does not start a new turn). */
export async function steerAgent(
  client: DaemonClient,
  ctx: CliContext,
  agentId: string,
  message: string,
  opts: GlobalOptions,
  mode: "steer" | "followUp",
): Promise<number> {
  const rpc = mode === "steer" ? AGENT_RPC.steer : AGENT_RPC.followUp;
  const payload = (await client.request(rpc, { agentId, message })) as { ok?: boolean };
  if (opts.json) {
    ctx.sink.write(renderJson(payload));
  } else {
    ctx.sink.write(
      payload.ok
        ? mode === "steer"
          ? "steered"
          : "queued follow-up"
        : "not delivered (no live turn)",
    );
  }
  return payload.ok === false ? EXIT_ERROR : EXIT_OK;
}

/** Generic single-agent RPC by id (stop/archive/delete/reload/wait). */
async function simpleAgentRpc(
  client: DaemonClient,
  ctx: CliContext,
  type: string,
  agentId: string,
  okText: string,
  opts: GlobalOptions,
  extra: Record<string, unknown> = {},
): Promise<number> {
  const payload = await client.request(type, { agentId, ...extra });
  ctx.sink.write(opts.json ? renderJson(payload) : okText);
  return EXIT_OK;
}

/** `update` / `mode` — patch agent config. */
export async function updateAgent(
  client: DaemonClient,
  ctx: CliContext,
  agentId: string,
  patch: Record<string, unknown>,
  opts: GlobalOptions,
): Promise<number> {
  const payload = await client.request(AGENT_RPC.update, { agentId, ...patch });
  ctx.sink.write(opts.json ? renderJson(payload) : "updated");
  return EXIT_OK;
}

/** `inspect` — show agent detail. */
export async function inspectAgent(
  client: DaemonClient,
  ctx: CliContext,
  agentId: string,
  opts: GlobalOptions,
): Promise<number> {
  const payload = await client.request<Record<string, unknown>>(AGENT_RPC.inspect, { agentId });
  ctx.sink.write(opts.json ? renderJson(payload) : renderObject(payload));
  return EXIT_OK;
}

/** `logs` — fetch timeline history and print it. */
export async function logsAgent(
  client: DaemonClient,
  ctx: CliContext,
  agentId: string,
  opts: GlobalOptions & { limit?: number },
): Promise<number> {
  const payload = await client.request<{ items?: unknown[] }>(AGENT_RPC.timeline, {
    agentId,
    direction: "backward",
    limit: opts.limit ?? 100,
  });
  if (opts.json) {
    ctx.sink.write(renderJson(payload));
    return EXIT_OK;
  }
  for (const item of payload.items ?? []) {
    const event = (item as { event?: AgentStreamEvent }).event ?? (item as AgentStreamEvent);
    const line = formatStreamEvent(event);
    // Textless events (`assistant_message.final` block-close markers, empty deltas) render to
    // nothing — don't punch a blank line into the log.
    if (line) ctx.sink.write(line);
  }
  return EXIT_OK;
}

export interface AttachOptions extends GlobalOptions {
  /** Resolve once a terminal turn event arrives (used by tests + `--until-idle`). */
  untilTurnEnd?: boolean;
  /** Abort the stream (SIGINT in production). */
  signal?: AbortSignal;
}

/** `attach` — subscribe to the live timeline and stream events to the terminal. */
export function attachAgent(
  client: DaemonClient,
  ctx: CliContext,
  agentId: string,
  opts: AttachOptions,
): Promise<number> {
  return new Promise<number>((resolve) => {
    const unsubscribe = client.onSessionMessage((msg) => {
      const m = msg as unknown as { type?: string; agentId?: string; event?: AgentStreamEvent };
      if (m.type !== "agent_stream" || m.agentId !== agentId || !m.event) return;
      if (opts.json) {
        ctx.sink.write(renderJson(m.event));
      } else {
        const line = formatStreamEvent(m.event);
        if (line) ctx.sink.write(line);
      }
      if (opts.untilTurnEnd && isTerminalEvent(m.event)) {
        unsubscribe();
        resolve(EXIT_OK);
      }
    });

    if (opts.signal) {
      if (opts.signal.aborted) {
        unsubscribe();
        resolve(EXIT_OK);
        return;
      }
      opts.signal.addEventListener("abort", () => {
        unsubscribe();
        resolve(EXIT_OK);
      });
    }
  });
}

// ─── Slash-command operations (sprint-037) ───────────────────────────────────────

/** `/session` — read-only session stats (tokens, cost, context-window usage). */
export async function sessionStatsAgent(
  client: DaemonClient,
  ctx: CliContext,
  agentId: string,
  opts: GlobalOptions,
): Promise<number> {
  const payload = await client.request<Record<string, unknown>>(AGENT_RPC.sessionStats, {
    agentId,
  });
  ctx.sink.write(opts.json ? renderJson(payload) : renderObject(payload));
  return EXIT_OK;
}

/** `/compact` — manually compact conversation context. */
export async function compactAgent(
  client: DaemonClient,
  ctx: CliContext,
  agentId: string,
  customInstructions: string | undefined,
  opts: GlobalOptions,
): Promise<number> {
  const payload = await client.request<Record<string, unknown>>(AGENT_RPC.compact, {
    agentId,
    customInstructions,
  });
  ctx.sink.write(opts.json ? renderJson(payload) : renderObject(payload));
  return EXIT_OK;
}

/** `/new` — start a fresh session in place. */
export async function newAgentSession(
  client: DaemonClient,
  ctx: CliContext,
  agentId: string,
  opts: GlobalOptions,
): Promise<number> {
  const payload = await client.request<{ cancelled: boolean }>(AGENT_RPC.newSession, { agentId });
  ctx.sink.write(
    opts.json ? renderJson(payload) : payload.cancelled ? "cancelled" : "new session started",
  );
  return EXIT_OK;
}

/** `/resume` — load a different session file in place. */
export async function switchAgentSession(
  client: DaemonClient,
  ctx: CliContext,
  agentId: string,
  sessionPath: string,
  opts: GlobalOptions,
): Promise<number> {
  const payload = await client.request<{ cancelled: boolean }>(AGENT_RPC.switchSession, {
    agentId,
    sessionPath,
  });
  ctx.sink.write(
    opts.json ? renderJson(payload) : payload.cancelled ? "cancelled" : "session switched",
  );
  return EXIT_OK;
}

/** `/fork` — create a new branch from a previous user message. */
export async function forkAgent(
  client: DaemonClient,
  ctx: CliContext,
  agentId: string,
  entryId: string,
  opts: GlobalOptions,
): Promise<number> {
  const payload = await client.request<Record<string, unknown>>(AGENT_RPC.fork, {
    agentId,
    entryId,
  });
  ctx.sink.write(opts.json ? renderJson(payload) : renderObject(payload));
  return EXIT_OK;
}

interface ForkMessageRow extends Record<string, unknown> {
  entryId: string;
  text: string;
}

/** Fork picker — user messages available to fork from. */
export async function forkMessagesAgent(
  client: DaemonClient,
  ctx: CliContext,
  agentId: string,
  opts: GlobalOptions,
): Promise<number> {
  const payload = await client.request<{ messages?: ForkMessageRow[] }>(AGENT_RPC.forkMessages, {
    agentId,
  });
  ctx.sink.write(
    opts.json ? renderJson(payload) : renderTable(payload.messages ?? [], ["entryId", "text"]),
  );
  return EXIT_OK;
}

/** `/clone` — duplicate the active branch into a new session at the current position. */
export async function cloneAgentSession(
  client: DaemonClient,
  ctx: CliContext,
  agentId: string,
  opts: GlobalOptions,
): Promise<number> {
  const payload = await client.request<{ cancelled: boolean }>(AGENT_RPC.clone, { agentId });
  ctx.sink.write(opts.json ? renderJson(payload) : payload.cancelled ? "cancelled" : "cloned");
  return EXIT_OK;
}

/** `/name` — set the session display name. */
export async function setAgentSessionName(
  client: DaemonClient,
  ctx: CliContext,
  agentId: string,
  name: string,
  opts: GlobalOptions,
): Promise<number> {
  const payload = await client.request(AGENT_RPC.setSessionName, { agentId, name });
  ctx.sink.write(opts.json ? renderJson(payload) : "renamed");
  return EXIT_OK;
}

/** `/export` — export the session to an HTML file. */
export async function exportAgentHtml(
  client: DaemonClient,
  ctx: CliContext,
  agentId: string,
  outputPath: string | undefined,
  opts: GlobalOptions,
): Promise<number> {
  const payload = await client.request<{ path?: string }>(AGENT_RPC.exportHtml, {
    agentId,
    outputPath,
  });
  ctx.sink.write(opts.json ? renderJson(payload) : (payload.path ?? "(no path)"));
  return EXIT_OK;
}

/** `/model` (set) — switch to a specific provider model. */
export async function setAgentModel(
  client: DaemonClient,
  ctx: CliContext,
  agentId: string,
  provider: string,
  modelId: string,
  opts: GlobalOptions,
): Promise<number> {
  const payload = await client.request<Record<string, unknown>>(AGENT_RPC.setModel, {
    agentId,
    provider,
    modelId,
  });
  ctx.sink.write(opts.json ? renderJson(payload) : renderObject(payload));
  return EXIT_OK;
}

/** `/model` (cycle) — cycle to the next available model. */
export async function cycleAgentModel(
  client: DaemonClient,
  ctx: CliContext,
  agentId: string,
  opts: GlobalOptions,
): Promise<number> {
  const payload = await client.request<Record<string, unknown>>(AGENT_RPC.cycleModel, {
    agentId,
  });
  ctx.sink.write(opts.json ? renderJson(payload) : renderObject(payload));
  return EXIT_OK;
}

/** `/copy` — the text content of the last assistant message. */
export async function lastAssistantTextAgent(
  client: DaemonClient,
  ctx: CliContext,
  agentId: string,
  opts: GlobalOptions,
): Promise<number> {
  const payload = await client.request<{ text?: string | null }>(AGENT_RPC.lastAssistantText, {
    agentId,
  });
  ctx.sink.write(opts.json ? renderJson(payload) : (payload.text ?? "(none)"));
  return EXIT_OK;
}

// ─── Command discovery (sprint-040) ───

interface AgentCommandRow extends Record<string, unknown> {
  name: string;
  description?: string;
  source?: string;
  scope?: string;
  path?: string;
}

/** Command discovery — extension commands, prompt templates, and skills (Pi `get_commands`). */
export async function listAgentCommands(
  client: DaemonClient,
  ctx: CliContext,
  agentId: string,
  opts: GlobalOptions,
): Promise<number> {
  const payload = await client.request<{ commands?: AgentCommandRow[] }>(AGENT_RPC.listCommands, {
    agentId,
  });
  ctx.sink.write(
    opts.json
      ? renderJson(payload)
      : renderTable(payload.commands ?? [], ["name", "source", "scope", "description"]),
  );
  return EXIT_OK;
}

// ─── Commander wiring ───────────────────────────────────────────────────────────

export function registerAgentCommands(
  program: Command,
  ctx: CliContext,
  setExit: (code: number) => void,
): void {
  const g = (): GlobalOptions => program.opts<GlobalOptions>();

  const agent = program.command("agent").description("manage agents");

  // ls (+ top-level alias)
  const lsAction = (o: { all?: boolean; global?: boolean }) =>
    withDaemon(ctx, g(), (client) =>
      lsAgents(client, ctx, { all: o.all, global: o.global, json: g().json }),
    ).then(setExit);
  agent
    .command("ls")
    .description("list agents")
    .option("-a, --all", "include closed/archived agents")
    .option("-g, --global", "include agents from all workspaces")
    .action(lsAction);
  program
    .command("ls")
    .description("list agents (alias of `agent ls`)")
    .option("-a, --all", "include closed/archived agents")
    .option("-g, --global", "include agents from all workspaces")
    .action(lsAction);

  // run (+ top-level alias)
  const runAction = (prompt: string, o: RunOptions) =>
    withDaemon(ctx, g(), (client) => runAgent(client, ctx, prompt, { ...o, json: g().json })).then(
      setExit,
    );
  agent
    .command("run <prompt>")
    .description("create and run an agent")
    .option("-p, --provider <provider/model>", "provider id and model, e.g. pi/<model>")
    .option("-w, --worktree <name>", "run inside a Pi-Studio worktree")
    .option("--cwd <dir>", "working directory for the agent")
    .action(runAction);
  program
    .command("run <prompt>")
    .description("create and run an agent (alias of `agent run`)")
    .option("-p, --provider <provider/model>", "provider id and model, e.g. pi/<model>")
    .option("-w, --worktree <name>", "run inside a Pi-Studio worktree")
    .option("--cwd <dir>", "working directory for the agent")
    .action(runAction);

  // attach (+ top-level alias)
  const attachAction = (agentId: string, o: { untilIdle?: boolean }) =>
    withDaemon(ctx, g(), (client) =>
      attachAgent(client, ctx, agentId, { json: g().json, untilTurnEnd: o.untilIdle }),
    ).then(setExit);
  agent
    .command("attach <agentId>")
    .description("stream the live timeline")
    .option("--until-idle", "exit when the current turn ends")
    .action(attachAction);
  program
    .command("attach <agentId>")
    .description("stream the live timeline (alias of `agent attach`)")
    .option("--until-idle", "exit when the current turn ends")
    .action(attachAction);

  // logs (+ top-level alias)
  const logsAction = (agentId: string, o: { limit?: string }) =>
    withDaemon(ctx, g(), (client) =>
      logsAgent(client, ctx, agentId, {
        json: g().json,
        limit: o.limit ? Number(o.limit) : undefined,
      }),
    ).then(setExit);
  agent
    .command("logs <agentId>")
    .description("fetch timeline history")
    .option("-n, --limit <n>", "max events")
    .action(logsAction);
  program
    .command("logs <agentId>")
    .description("fetch timeline history (alias of `agent logs`)")
    .option("-n, --limit <n>", "max events")
    .action(logsAction);

  // send (+ top-level alias)
  const sendAction = (agentId: string, prompt: string) =>
    withDaemon(ctx, g(), (client) => sendAgent(client, ctx, agentId, prompt, g())).then(setExit);
  agent
    .command("send <agentId> <prompt>")
    .description("send a follow-up prompt")
    .action(sendAction);
  program
    .command("send <agentId> <prompt>")
    .description("send a follow-up prompt (alias of `agent send`)")
    .action(sendAction);

  // steer / follow-up (+ top-level aliases) — inject into a LIVE turn
  const steerAction = (agentId: string, message: string) =>
    withDaemon(ctx, g(), (client) => steerAgent(client, ctx, agentId, message, g(), "steer")).then(
      setExit,
    );
  agent
    .command("steer <agentId> <message>")
    .description(
      "steer a running turn (delivered after the current tool calls, before the next LLM call)",
    )
    .action(steerAction);
  program
    .command("steer <agentId> <message>")
    .description("steer a running turn (alias of `agent steer`)")
    .action(steerAction);
  const followUpAction = (agentId: string, message: string) =>
    withDaemon(ctx, g(), (client) =>
      steerAgent(client, ctx, agentId, message, g(), "followUp"),
    ).then(setExit);
  agent
    .command("follow-up <agentId> <message>")
    .description("queue a follow-up message delivered after the agent stops")
    .action(followUpAction);

  // stop / archive / delete / reload / wait
  agent
    .command("stop <agentId>")
    .description("interrupt the current turn")
    .action((agentId: string) =>
      withDaemon(ctx, g(), (client) =>
        simpleAgentRpc(client, ctx, AGENT_RPC.stop, agentId, "stopped", g()),
      ).then(setExit),
    );
  agent
    .command("archive <agentId>")
    .description("archive (soft-delete) an agent")
    .action((agentId: string) =>
      withDaemon(ctx, g(), (client) =>
        simpleAgentRpc(client, ctx, AGENT_RPC.archive, agentId, "archived", g()),
      ).then(setExit),
    );
  agent
    .command("delete <agentId>")
    .description("delete an agent")
    .action((agentId: string) =>
      withDaemon(ctx, g(), (client) =>
        simpleAgentRpc(client, ctx, AGENT_RPC.delete, agentId, "deleted", g()),
      ).then(setExit),
    );
  agent
    .command("reload <agentId>")
    .description("reload/resume a closed session")
    .action((agentId: string) =>
      withDaemon(ctx, g(), (client) =>
        simpleAgentRpc(client, ctx, AGENT_RPC.resume, agentId, "reloaded", g()),
      ).then(setExit),
    );
  agent
    .command("wait <agentId>")
    .description("wait for the agent to finish")
    .action((agentId: string) =>
      withDaemon(ctx, g(), (client) =>
        simpleAgentRpc(client, ctx, AGENT_RPC.wait, agentId, "finished", g()),
      ).then(setExit),
    );

  // import
  agent
    .command("import <sessionRef>")
    .description("import a provider-native session")
    .action((sessionRef: string) =>
      withDaemon(ctx, g(), async (client) => {
        const payload = await client.request(AGENT_RPC.import, { sessionRef });
        ctx.sink.write(
          g().json ? renderJson(payload) : renderObject(payload as Record<string, unknown>),
        );
        return EXIT_OK;
      }).then(setExit),
    );

  // inspect
  agent
    .command("inspect <agentId>")
    .description("show agent detail")
    .action((agentId: string) =>
      withDaemon(ctx, g(), (client) => inspectAgent(client, ctx, agentId, g())).then(setExit),
    );

  // update
  agent
    .command("update <agentId>")
    .description("update agent config (model/mode/thinking/title)")
    .option("--model <model>", "set the model")
    .option("--mode <modeId>", "set the mode")
    .option("--thinking <id>", "set the thinking option")
    .option("--title <title>", "set the title")
    .action((agentId: string, o: Record<string, string>) => {
      const patch: Record<string, unknown> = {};
      if (o.model) patch.model = o.model;
      if (o.mode) patch.modeId = o.mode;
      if (o.thinking) patch.thinkingOptionId = o.thinking;
      if (o.title) patch.title = o.title;
      return withDaemon(ctx, g(), (client) => updateAgent(client, ctx, agentId, patch, g())).then(
        setExit,
      );
    });

  // mode (shortcut for update --mode)
  agent
    .command("mode <agentId> <modeId>")
    .description("set the agent mode")
    .action((agentId: string, modeId: string) =>
      withDaemon(ctx, g(), (client) => updateAgent(client, ctx, agentId, { modeId }, g())).then(
        setExit,
      ),
    );

  // Slash-command operations (sprint-037): CLI equivalents of Pi built-in slash commands that
  // have a real Pi RPC equivalent. See packages/server/AGENTS.md's Agent subsystem section.

  // session — /session: read-only stats (tokens, cost, context-window usage).
  agent
    .command("session <agentId>")
    .description("show session stats (tokens, cost, context usage) — /session")
    .action((agentId: string) =>
      withDaemon(ctx, g(), (client) => sessionStatsAgent(client, ctx, agentId, g())).then(setExit),
    );

  // compact — /compact: manually compact conversation context.
  agent
    .command("compact <agentId>")
    .description("manually compact the session context — /compact")
    .option("-i, --instructions <text>", "custom compaction instructions")
    .action((agentId: string, o: { instructions?: string }) =>
      withDaemon(ctx, g(), (client) =>
        compactAgent(client, ctx, agentId, o.instructions, g()),
      ).then(setExit),
    );

  // new-session — /new: start a fresh session in place.
  agent
    .command("new-session <agentId>")
    .description("start a fresh session in place — /new")
    .action((agentId: string) =>
      withDaemon(ctx, g(), (client) => newAgentSession(client, ctx, agentId, g())).then(setExit),
    );

  // resume-session — /resume: load a different session file in place.
  agent
    .command("resume-session <agentId>")
    .description("load a different session file in place — /resume")
    .requiredOption("-p, --path <sessionPath>", "JSONL session file to switch to")
    .action((agentId: string, o: { path: string }) =>
      withDaemon(ctx, g(), (client) => switchAgentSession(client, ctx, agentId, o.path, g())).then(
        setExit,
      ),
    );

  // fork / fork-messages — /fork: create a new branch from a previous user message.
  agent
    .command("fork <agentId>")
    .description("create a new branch from a previous user message — /fork")
    .requiredOption("-e, --entry <entryId>", "entry id to fork from (see `agent fork-messages`)")
    .action((agentId: string, o: { entry: string }) =>
      withDaemon(ctx, g(), (client) => forkAgent(client, ctx, agentId, o.entry, g())).then(setExit),
    );
  agent
    .command("fork-messages <agentId>")
    .description("list user messages available to fork from")
    .action((agentId: string) =>
      withDaemon(ctx, g(), (client) => forkMessagesAgent(client, ctx, agentId, g())).then(setExit),
    );

  // clone — /clone: duplicate the active branch into a new session at the current position.
  agent
    .command("clone <agentId>")
    .description("duplicate the current session at the current position — /clone")
    .action((agentId: string) =>
      withDaemon(ctx, g(), (client) => cloneAgentSession(client, ctx, agentId, g())).then(setExit),
    );

  // name — /name: set the session display name.
  agent
    .command("name <agentId> <name>")
    .description("set the session display name — /name")
    .action((agentId: string, name: string) =>
      withDaemon(ctx, g(), (client) => setAgentSessionName(client, ctx, agentId, name, g())).then(
        setExit,
      ),
    );

  // export — /export: export the session to an HTML file.
  agent
    .command("export <agentId>")
    .description("export session to an HTML file — /export")
    .option("-o, --out <path>", "output file path")
    .action((agentId: string, o: { out?: string }) =>
      withDaemon(ctx, g(), (client) => exportAgentHtml(client, ctx, agentId, o.out, g())).then(
        setExit,
      ),
    );

  // model (set) / cycle-model — /model: switch or cycle the provider model.
  agent
    .command("model <agentId>")
    .description("switch to a specific provider model — /model")
    .requiredOption("--provider <provider>", "provider id, e.g. anthropic")
    .requiredOption("--model <modelId>", "model id")
    .action((agentId: string, o: { provider: string; model: string }) =>
      withDaemon(ctx, g(), (client) =>
        setAgentModel(client, ctx, agentId, o.provider, o.model, g()),
      ).then(setExit),
    );
  agent
    .command("cycle-model <agentId>")
    .description("cycle to the next available model — /model")
    .action((agentId: string) =>
      withDaemon(ctx, g(), (client) => cycleAgentModel(client, ctx, agentId, g())).then(setExit),
    );

  // last-message — /copy: the text content of the last assistant message.
  agent
    .command("last-message <agentId>")
    .description("print the last assistant message — /copy")
    .action((agentId: string) =>
      withDaemon(ctx, g(), (client) => lastAssistantTextAgent(client, ctx, agentId, g())).then(
        setExit,
      ),
    );

  // commands — command discovery: extension commands, prompt templates, and skills.
  agent
    .command("commands <agentId>")
    .description("list discoverable commands: extensions, prompt templates, skills")
    .action((agentId: string) =>
      withDaemon(ctx, g(), (client) => listAgentCommands(client, ctx, agentId, g())).then(setExit),
    );
}
