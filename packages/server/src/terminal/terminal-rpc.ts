import { tryDecodeTerminalFrame } from "@av-pi-studio/protocol";

import { readProjectConfig } from "../config/project-config.js";
import type { Session } from "../ws/session.js";
import type { BinaryHandler, HandlerRegistry } from "../ws/router.js";
import type { TerminalManager } from "./terminal-manager.js";

/**
 * Terminal control RPC surface + capture/restore semantics (features/terminals.md § Control RPCs,
 * § Restore / snapshot). Per-slot binary streams are piped to the requesting session; restore modes
 * are gated by `features["terminal-restore-modes"]`.
 */

export interface TerminalRpcDeps {
  manager: TerminalManager;
  broadcast: (sessions: Iterable<Session>, message: unknown) => void;
  /** Whether the daemon advertises `features["terminal-restore-modes"]`. */
  restoreModesEnabled: boolean;
  /** Resolve a project root → `pi-studio.json` path (for StartWorkspaceScriptRequest). */
  projectConfigPath: (cwd: string) => string;
}

export function registerTerminalHandlers(
  registry: HandlerRegistry,
  deps: TerminalRpcDeps,
  getActiveSessions: () => Iterable<Session>,
): void {
  const { manager } = deps;
  // Per (session, slot) stream unsubscribers.
  const streamUnsubs = new Map<string, () => void>();
  const key = (session: Session, slot: number) => `${session.id}:${slot}`;

  registry.register("list_terminals_request", () => ({
    type: "list_terminals_response",
    terminals: manager.list(),
  }));

  registry.register("subscribe_terminals_request", () => ({
    type: "subscribe_terminals_response",
    terminals: manager.list(),
  }));
  registry.register("unsubscribe_terminals_request", () => ({
    type: "unsubscribe_terminals_response",
    ok: true,
  }));

  registry.register("create_terminal_request", (ctx) => {
    const entry = manager.createTerminal({
      workspaceId: String(ctx.message.workspaceId ?? ""),
      cwd: ctx.message.cwd as string | undefined,
      shell: ctx.message.shell as string | undefined,
      name: ctx.message.name as string | undefined,
      cols: ctx.message.cols as number | undefined,
      rows: ctx.message.rows as number | undefined,
    });
    deps.broadcast(getActiveSessions(), { type: "terminals_update", terminals: manager.list() });
    return { type: "create_terminal_response", terminal: entry };
  });

  registry.register("rename_terminal_request", (ctx) => {
    const slot = Number(ctx.message.slot);
    const ok = manager.rename(slot, String(ctx.message.name ?? ""));
    if (ok)
      deps.broadcast(getActiveSessions(), { type: "terminals_update", terminals: manager.list() });
    return { type: "rename_terminal_response", slot, ok };
  });

  registry.register("subscribe_terminal_request", (ctx) => {
    const slot = Number(ctx.message.slot);
    const session = ctx.session;
    // Restore mode is honored only when the daemon advertises the feature AND the client advertised
    // the reflowable-snapshot capability. Otherwise fall back to the basic snapshot (ignore mode).
    const requestedMode = ctx.message.restoreMode as string | undefined;
    const clientReflowable = session.supports("terminal_reflowable_snapshot");
    const restoreMode =
      deps.restoreModesEnabled && clientReflowable ? (requestedMode ?? "basic") : "basic";

    streamUnsubs.get(key(session, slot))?.(); // replace existing subscription
    try {
      const unsub = manager.subscribe(slot, (frame) => session.sendBinary(frame));
      streamUnsubs.set(key(session, slot), unsub);
      return { type: "subscribe_terminal_response", slot, ok: true, restoreMode };
    } catch {
      return { type: "subscribe_terminal_response", slot, ok: false, error: "no_such_terminal" };
    }
  });

  registry.register("unsubscribe_terminal_request", (ctx) => {
    const slot = Number(ctx.message.slot);
    streamUnsubs.get(key(ctx.session, slot))?.();
    streamUnsubs.delete(key(ctx.session, slot));
    return { type: "unsubscribe_terminal_response", slot, ok: true };
  });

  // Text-RPC input (binary input frames are handled by the binary router below).
  registry.register("terminal_input", (ctx) => {
    const slot = Number(ctx.message.slot);
    const data =
      typeof ctx.message.data === "string"
        ? Buffer.from(ctx.message.data, "base64")
        : Buffer.from([]);
    manager.input(slot, new Uint8Array(data));
    return undefined; // fire-and-forget
  });

  registry.register("kill_terminal_request", (ctx) => {
    const slot = Number(ctx.message.slot);
    const ok = manager.kill(slot);
    deps.broadcast(getActiveSessions(), { type: "terminals_update", terminals: manager.list() });
    return { type: "kill_terminal_response", slot, ok };
  });

  registry.register("capture_terminal_request", (ctx) => {
    const slot = Number(ctx.message.slot);
    const screen = manager.capture(slot);
    return { type: "capture_terminal_response", slot, ok: screen !== null, screen: screen ?? "" };
  });

  registry.register("start_workspace_script_request", async (ctx) => {
    const cwd = String(ctx.message.cwd ?? "");
    const scriptName = String(ctx.message.script ?? ctx.message.name ?? "");
    const { config } = await readProjectConfig(deps.projectConfigPath(cwd));
    const script = config.scripts[scriptName];
    if (!script) {
      return { type: "start_workspace_script_response", ok: false, error: "script_not_found" };
    }
    const isService = script.type === "service";
    const entry = manager.createTerminal({
      workspaceId: String(ctx.message.workspaceId ?? ""),
      cwd,
      shell: "/bin/sh",
      args: ["-c", script.command],
      name: scriptName,
      service: isService,
    });
    deps.broadcast(getActiveSessions(), { type: "terminals_update", terminals: manager.list() });
    // Service scripts are handed to the service proxy (task-003) by the caller via `entry.service`.
    return {
      type: "start_workspace_script_response",
      ok: true,
      terminal: entry,
      service: isService,
    };
  });
}

/** Binary terminal-input frame handler for the frame dispatcher (Input/Resize opcodes). */
export function makeTerminalBinaryHandler(manager: TerminalManager): BinaryHandler {
  return (_session, bytes) => {
    const frame = tryDecodeTerminalFrame(bytes);
    if (!frame) return;
    if (frame.opcode === "Input") manager.input(frame.slot, frame.data);
    else if (frame.opcode === "Resize") manager.resize(frame.slot, frame.cols, frame.rows);
  };
}
