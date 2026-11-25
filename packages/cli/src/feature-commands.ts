import { type DaemonClient, WORKTREE_TIMEOUT_MS } from "@av-pi-studio/client";
import type { Command } from "commander";

import { type CliContext, type GlobalOptions, EXIT_OK, withDaemon } from "./cli-core.js";
import { renderJson, renderObject, renderTable } from "./output.js";

/**
 * Feature command groups (features/cli.md § Command tree): terminal, provider, worktree, plus
 * top-level `open`/`<path>`. Each command maps to the same WS RPC as its app/MCP equivalent and
 * matches a registered daemon handler.
 */

export const FEATURE_RPC = {
  // terminal (registered handlers).
  terminalList: "list_terminals_request",
  terminalCreate: "create_terminal_request",
  terminalCapture: "capture_terminal_request",
  terminalInput: "terminal_input",
  terminalKill: "kill_terminal_request",
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

/** Run a single RPC and render its payload, returning an exit code. `timeoutMs` overrides the
 *  connection's default RPC timeout for a request that is slow by nature (see the SDK's named
 *  `*_TIMEOUT_MS` constants). */
export async function featureRpc(
  ctx: CliContext,
  opts: GlobalOptions,
  type: string,
  params: Record<string, unknown>,
  render: RenderFn,
  timeoutMs?: number,
): Promise<number> {
  return withDaemon(ctx, opts, async (client: DaemonClient) => {
    const payload = await client.request(type, params, timeoutMs);
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
  const run = (
    type: string,
    params: Record<string, unknown>,
    render: RenderFn,
    timeoutMs?: number,
  ) => featureRpc(ctx, g(), type, params, render, timeoutMs).then(setExit);

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
      run(
        FEATURE_RPC.worktreeCreate,
        { name, workspaceId: o.workspace },
        objectRender,
        WORKTREE_TIMEOUT_MS,
      ),
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
    .action((name: string) =>
      run(FEATURE_RPC.worktreeArchive, { name }, ack("archived"), WORKTREE_TIMEOUT_MS),
    );

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
