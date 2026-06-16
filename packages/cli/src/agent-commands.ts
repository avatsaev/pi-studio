import type { DaemonClient } from "@av-pi-studio/client";
import type { AgentStreamEvent } from "@av-pi-studio/protocol";
import type { Command } from "commander";

import { type CliContext, type GlobalOptions, EXIT_OK, withDaemon } from "./cli-core.js";
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
    ctx.sink.write(formatStreamEvent(event));
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
      ctx.sink.write(opts.json ? renderJson(m.event) : formatStreamEvent(m.event));
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
}
