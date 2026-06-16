import type { DaemonClient } from "@av-pi-studio/client";
import type { Command } from "commander";

import { type CliContext, type GlobalOptions, EXIT_OK, withDaemon } from "./cli-core.js";
import { renderJson, renderObject, renderTable } from "./output.js";

/**
 * Feature command groups (features/cli.md § Command tree): chat, terminal, loop, schedule, permit,
 * provider, worktree, plus top-level `open`/`<path>`. Each command maps to the same WS RPC as its
 * app/MCP equivalent.
 *
 * Terminal / worktree / provider / permission RPC names match registered daemon handlers and MCP
 * tools. Chat / loop / schedule wire names follow the daemon's `_request` convention and the message
 * names in the per-feature scopes (e.g. `ChatCreateRequest` → `chat_create_request`); their daemon
 * handlers land in an integration sprint — flagged TODO(verify) in `FEATURE_RPC`.
 */

export const FEATURE_RPC = {
  // chat (chat-rooms.md § Operations) — TODO(verify) wire names.
  chatCreate: "chat_create_request",
  chatList: "chat_list_request",
  chatInspect: "chat_inspect_request",
  chatPost: "chat_post_request",
  chatRead: "chat_read_request",
  chatWait: "chat_wait_request",
  chatDelete: "chat_delete_request",
  // terminal (registered handlers).
  terminalList: "list_terminals_request",
  terminalCreate: "create_terminal_request",
  terminalCapture: "capture_terminal_request",
  terminalInput: "terminal_input",
  terminalKill: "kill_terminal_request",
  // loop — TODO(verify) wire names.
  loopRun: "loop_run_request",
  loopList: "loop_list_request",
  loopInspect: "loop_inspect_request",
  loopLogs: "loop_logs_request",
  loopStop: "loop_stop_request",
  // schedule — TODO(verify) wire names.
  scheduleCreate: "schedule_create_request",
  scheduleList: "schedule_list_request",
  scheduleInspect: "schedule_inspect_request",
  scheduleUpdate: "schedule_update_request",
  schedulePause: "schedule_pause_request",
  scheduleResume: "schedule_resume_request",
  scheduleRunOnce: "schedule_run_once_request",
  scheduleLogs: "schedule_logs_request",
  scheduleDelete: "schedule_delete_request",
  // permit (registered: respond_to_permission alias). list — TODO(verify).
  permitRespond: "respond_to_permission",
  permitList: "list_permissions_request",
  // provider (MCP tools / facade RPCs).
  providerList: "list_providers",
  providerModels: "list_models",
  // worktree (registered handlers).
  worktreeCreate: "create_pistudio_worktree_request",
  worktreeList: "pistudio_worktree_list_request",
  worktreeArchive: "pistudio_worktree_archive_request",
  // open project (registered handler).
  openProject: "open_project_request",
} as const;

type RenderFn = (payload: unknown) => string;

/** Render a list payload (`payload[key]`) as a table, or the whole payload otherwise. */
function tableOf(key: string, columns?: string[]): RenderFn {
  return (payload) => {
    const rows = (payload as Record<string, unknown>)?.[key];
    if (Array.isArray(rows)) return renderTable(rows as Array<Record<string, unknown>>, columns);
    return renderObject((payload ?? {}) as Record<string, unknown>);
  };
}

const ack =
  (text: string): RenderFn =>
  () =>
    text;
const objectRender: RenderFn = (payload) =>
  renderObject((payload ?? {}) as Record<string, unknown>);

// ─── Generic dispatch ─────────────────────────────────────────────────────────

/** Run a single RPC and render its payload, returning an exit code. */
export async function featureRpc(
  ctx: CliContext,
  opts: GlobalOptions,
  type: string,
  params: Record<string, unknown>,
  render: RenderFn,
): Promise<number> {
  return withDaemon(ctx, opts, async (client: DaemonClient) => {
    const payload = await client.request(type, params);
    ctx.sink.write(opts.json ? renderJson(payload) : render(payload));
    return EXIT_OK;
  });
}

// ─── Commander wiring ───────────────────────────────────────────────────────────

export function registerFeatureCommands(
  program: Command,
  ctx: CliContext,
  setExit: (code: number) => void,
): void {
  const g = (): GlobalOptions => program.opts<GlobalOptions>();
  const run = (type: string, params: Record<string, unknown>, render: RenderFn) =>
    featureRpc(ctx, g(), type, params, render).then(setExit);

  // ── chat ──
  const chat = program.command("chat").description("agent-to-agent / human-to-agent chat rooms");
  chat
    .command("create <name>")
    .option("--purpose <purpose>", "room purpose")
    .description("create a chat room")
    .action((name: string, o: { purpose?: string }) =>
      run(FEATURE_RPC.chatCreate, { name, purpose: o.purpose }, objectRender),
    );
  chat
    .command("ls")
    .description("list chat rooms")
    .action(() => run(FEATURE_RPC.chatList, {}, tableOf("rooms", ["roomId", "name", "purpose"])));
  chat
    .command("inspect <roomId>")
    .description("inspect a chat room")
    .action((roomId: string) => run(FEATURE_RPC.chatInspect, { roomId }, objectRender));
  chat
    .command("post <roomId> <message>")
    .option("--from <author>", "author id")
    .description("post a message")
    .action((roomId: string, message: string, o: { from?: string }) =>
      run(FEATURE_RPC.chatPost, { roomId, message, from: o.from }, ack("posted")),
    );
  chat
    .command("read <roomId>")
    .option("-n, --limit <n>", "max messages")
    .description("read messages")
    .action((roomId: string, o: { limit?: string }) =>
      run(
        FEATURE_RPC.chatRead,
        { roomId, limit: o.limit ? Number(o.limit) : undefined },
        tableOf("messages", ["author", "text", "createdAt"]),
      ),
    );
  chat
    .command("wait <roomId>")
    .description("wait for new messages")
    .action((roomId: string) =>
      run(FEATURE_RPC.chatWait, { roomId }, tableOf("messages", ["author", "text"])),
    );
  chat
    .command("delete <roomId>")
    .description("delete a chat room")
    .action((roomId: string) => run(FEATURE_RPC.chatDelete, { roomId }, ack("deleted")));

  // ── terminal ──
  const terminal = program.command("terminal").description("workspace terminals");
  terminal
    .command("ls")
    .description("list terminals")
    .action(() =>
      run(FEATURE_RPC.terminalList, {}, tableOf("terminals", ["slot", "title", "cols", "rows"])),
    );
  terminal
    .command("create")
    .option("--workspace <id>", "workspace id")
    .option("--cwd <dir>", "working directory")
    .description("create a terminal")
    .action((o: { workspace?: string; cwd?: string }) =>
      run(FEATURE_RPC.terminalCreate, { workspaceId: o.workspace, cwd: o.cwd }, objectRender),
    );
  terminal
    .command("capture <slot>")
    .description("capture current screen text")
    .action((slot: string) =>
      run(FEATURE_RPC.terminalCapture, { slot: Number(slot) }, (p) =>
        String((p as { text?: string }).text ?? ""),
      ),
    );
  terminal
    .command("send-keys <slot> <data>")
    .description("send input to a terminal")
    .action((slot: string, data: string) =>
      run(FEATURE_RPC.terminalInput, { slot: Number(slot), data }, ack("sent")),
    );
  terminal
    .command("kill <slot>")
    .description("kill a terminal")
    .action((slot: string) => run(FEATURE_RPC.terminalKill, { slot: Number(slot) }, ack("killed")));

  // ── loop ──
  const loop = program.command("loop").description("looping agent runs");
  loop
    .command("run <prompt>")
    .option("--max <n>", "max iterations")
    .description("start a loop")
    .action((prompt: string, o: { max?: string }) =>
      run(
        FEATURE_RPC.loopRun,
        { prompt, maxIterations: o.max ? Number(o.max) : undefined },
        objectRender,
      ),
    );
  loop
    .command("ls")
    .description("list loops")
    .action(() =>
      run(FEATURE_RPC.loopList, {}, tableOf("loops", ["loopId", "status", "iteration"])),
    );
  loop
    .command("inspect <loopId>")
    .description("inspect a loop")
    .action((loopId: string) => run(FEATURE_RPC.loopInspect, { loopId }, objectRender));
  loop
    .command("logs <loopId>")
    .description("loop logs")
    .action((loopId: string) =>
      run(FEATURE_RPC.loopLogs, { loopId }, tableOf("entries", ["seq", "message"])),
    );
  loop
    .command("stop <loopId>")
    .description("stop a loop")
    .action((loopId: string) => run(FEATURE_RPC.loopStop, { loopId }, ack("stopped")));

  // ── schedule ──
  const schedule = program.command("schedule").description("cron-based scheduled agents");
  schedule
    .command("create <cron> <prompt>")
    .description("create a schedule")
    .action((cron: string, prompt: string) =>
      run(FEATURE_RPC.scheduleCreate, { cron, prompt }, objectRender),
    );
  schedule
    .command("ls")
    .description("list schedules")
    .action(() =>
      run(FEATURE_RPC.scheduleList, {}, tableOf("schedules", ["scheduleId", "cron", "nextRunAt"])),
    );
  schedule
    .command("inspect <id>")
    .description("inspect a schedule")
    .action((id: string) => run(FEATURE_RPC.scheduleInspect, { scheduleId: id }, objectRender));
  schedule
    .command("update <id>")
    .option("--cron <cron>", "new cron expression")
    .option("--prompt <prompt>", "new prompt")
    .description("update a schedule")
    .action((id: string, o: { cron?: string; prompt?: string }) =>
      run(
        FEATURE_RPC.scheduleUpdate,
        { scheduleId: id, cron: o.cron, prompt: o.prompt },
        ack("updated"),
      ),
    );
  schedule
    .command("pause <id>")
    .description("pause a schedule")
    .action((id: string) => run(FEATURE_RPC.schedulePause, { scheduleId: id }, ack("paused")));
  schedule
    .command("resume <id>")
    .description("resume a schedule")
    .action((id: string) => run(FEATURE_RPC.scheduleResume, { scheduleId: id }, ack("resumed")));
  schedule
    .command("run-once <id>")
    .description("run a schedule once now")
    .action((id: string) => run(FEATURE_RPC.scheduleRunOnce, { scheduleId: id }, objectRender));
  schedule
    .command("logs <id>")
    .description("schedule run logs")
    .action((id: string) =>
      run(FEATURE_RPC.scheduleLogs, { scheduleId: id }, tableOf("runs", ["runAt", "status"])),
    );
  schedule
    .command("delete <id>")
    .description("delete a schedule")
    .action((id: string) => run(FEATURE_RPC.scheduleDelete, { scheduleId: id }, ack("deleted")));

  // ── permit ──
  const permit = program.command("permit").description("tool-call permissions");
  permit
    .command("ls")
    .description("list pending permission requests")
    .action(() =>
      run(
        FEATURE_RPC.permitList,
        {},
        tableOf("permissions", ["permissionRequestId", "tool", "agentId"]),
      ),
    );
  permit
    .command("allow <permissionRequestId>")
    .description("allow a pending permission")
    .action((id: string) =>
      run(
        FEATURE_RPC.permitRespond,
        { permissionRequestId: id, response: "allow" },
        ack("allowed"),
      ),
    );
  permit
    .command("deny <permissionRequestId>")
    .description("deny a pending permission")
    .action((id: string) =>
      run(FEATURE_RPC.permitRespond, { permissionRequestId: id, response: "deny" }, ack("denied")),
    );

  // ── provider ──
  const provider = program.command("provider").description("agent providers");
  provider
    .command("ls")
    .description("list providers")
    .action(() =>
      run(FEATURE_RPC.providerList, {}, tableOf("providers", ["providerId", "name", "available"])),
    );
  provider
    .command("models <providerId>")
    .description("list a provider's models")
    .action((providerId: string) =>
      run(FEATURE_RPC.providerModels, { providerId }, tableOf("models", ["id", "name"])),
    );

  // ── worktree ──
  const worktree = program.command("worktree").description("Pi-Studio git worktrees");
  worktree
    .command("create <name>")
    .option("--workspace <id>", "workspace id")
    .description("create a worktree")
    .action((name: string, o: { workspace?: string }) =>
      run(FEATURE_RPC.worktreeCreate, { name, workspaceId: o.workspace }, objectRender),
    );
  worktree
    .command("ls")
    .description("list worktrees")
    .action(() =>
      run(FEATURE_RPC.worktreeList, {}, tableOf("worktrees", ["name", "path", "branch"])),
    );
  worktree
    .command("archive <name>")
    .description("archive a worktree")
    .action((name: string) => run(FEATURE_RPC.worktreeArchive, { name }, ack("archived")));

  // ── open project (top-level `open` + positional `<path>`) ──
  program
    .command("open <path>")
    .description("open a project at <path>")
    .action((path: string) => runOpenProject(ctx, g(), path).then(setExit));
}

/** Open a project at `path` (used by `open <path>` and the bare `pi-studio <path>` form). */
export function runOpenProject(
  ctx: CliContext,
  opts: GlobalOptions,
  path: string,
): Promise<number> {
  return featureRpc(ctx, opts, FEATURE_RPC.openProject, { path }, objectRender);
}
