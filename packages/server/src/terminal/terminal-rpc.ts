import { tryDecodeTerminalFrame } from "@av-pi-studio/protocol";

import { readProjectConfig } from "../config/project-config.js";
import type { Session } from "../ws/session.js";
import type { BinaryHandler, HandlerRegistry } from "../ws/router.js";
import type { RestoreMode, TerminalManager } from "./terminal-manager.js";

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
  // A terminal exit — self-exit (`exit`, a crash) or `kill()` — always broadcasts the same
  // `terminals_update` signal, unconditionally to every active session. This is the ONLY exit
  // broadcast: `kill_terminal_request` below relies on it rather than sending its own, since
  // `manager.kill()` invokes this listener synchronously and a second broadcast would duplicate it.
  manager.onTerminalExit(() => {
    deps.broadcast(getActiveSessions(), { type: "terminals_update", terminals: manager.list() });
  });

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
    // the reflowable-snapshot capability AND asked for it by name. The wire literal is exactly
    // "reflowable" (sprint-053/task-004) — any other requested value (including a future/typo'd
    // one) is served and echoed as "basic", so the response never names a tier that was not
    // actually served.
    const requestedMode = ctx.message.restoreMode as string | undefined;
    const clientReflowable = session.supports("terminal_reflowable_snapshot");
    const restoreMode: RestoreMode =
      deps.restoreModesEnabled && clientReflowable && requestedMode === "reflowable"
        ? "reflowable"
        : "basic";

    streamUnsubs.get(key(session, slot))?.(); // replace existing subscription
    try {
      // Resize BEFORE subscribing, using the grid the attaching client sent (if any).
      //
      // The basic Snapshot is a raw byte ring, so it reproduces the wrapping and absolute cursor
      // positioning of whatever width the PTY had when those bytes were written (`terminals.md`
      // § Restore / snapshot: "replaying at a different width is approximate by construction").
      // For a full-screen app that paints by absolute position — htop, vim — replaying an 80-column
      // stream into a 190-column emulator is not approximate, it is scrambled.
      //
      // A client-side resize after attaching cannot fix this: `subscribe` emits the snapshot
      // synchronously below, long before any client Resize frame could arrive, so the mangled bytes
      // are already on the wire. Resizing first means the PTY sees SIGWINCH and the app repaints at
      // the right width, and that repaint arrives as live Output right behind the snapshot — which
      // is exactly why manually dragging the pane "fixed" it before.
      //
      // Validation and the same-size no-op both live in `manager.resize` — the one choke point every
      // size path funnels through — so this passes the raw values straight through rather than
      // growing a second, drifting copy of those rules here. Broadcasts `terminals_update` when the
      // grid actually changed (sprint-053/task-007), so an already-attached second client's stale
      // belief gets corrected without it having to guess from a redundant `Resize` of its own.
      resizeAndBroadcast(
        manager,
        deps.broadcast,
        getActiveSessions,
        slot,
        Number(ctx.message.cols),
        Number(ctx.message.rows),
      );
      const unsub = manager.subscribe(slot, (frame) => session.sendBinary(frame), { restoreMode });
      streamUnsubs.set(key(session, slot), unsub);
      // Echo the PTY's real size so the client can seed its belief instead of guessing. Without
      // this a reattaching client cannot know what it is attaching to, and has to send a blind
      // reconcile that is either redundant or, worse, indistinguishable from a stale claim.
      const entry = manager.get(slot);
      return {
        type: "subscribe_terminal_response",
        slot,
        ok: true,
        restoreMode,
        ...(entry ? { cols: entry.cols, rows: entry.rows } : {}),
      };
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

/**
 * Apply a resize and broadcast the refreshed inventory to every active session, but only when the
 * grid actually changed (sprint-053/task-007). An unknown slot, an invalid grid, and a same-size
 * no-op must all stay silent — the binary `Resize` frame path is the hot path of every coalesced
 * pane-divider drag, and a broadcast per intermediate frame would defeat that coalescing.
 *
 * Compares `TerminalManager.get(slot)` before and after rather than trusting `resize`'s boolean
 * return (which is `true` for both an applied change and a same-size no-op) — `get` returns the
 * live entry object, which `resize` mutates in place, so the cols/rows are captured into locals
 * before the call rather than held as a stale reference to the same object.
 */
function resizeAndBroadcast(
  manager: TerminalManager,
  broadcast: TerminalRpcDeps["broadcast"],
  getActiveSessions: () => Iterable<Session>,
  slot: number,
  cols: number,
  rows: number,
): void {
  const before = manager.get(slot);
  const beforeCols = before?.cols;
  const beforeRows = before?.rows;
  if (!manager.resize(slot, cols, rows)) return;
  const after = manager.get(slot);
  if (after && (after.cols !== beforeCols || after.rows !== beforeRows)) {
    broadcast(getActiveSessions(), { type: "terminals_update", terminals: manager.list() });
  }
}

/** Binary terminal-input frame handler for the frame dispatcher (Input/Resize opcodes). */
export function makeTerminalBinaryHandler(
  manager: TerminalManager,
  broadcast: TerminalRpcDeps["broadcast"],
  getActiveSessions: () => Iterable<Session>,
): BinaryHandler {
  return (_session, bytes) => {
    const frame = tryDecodeTerminalFrame(bytes);
    if (!frame) return;
    if (frame.opcode === "Input") manager.input(frame.slot, frame.data);
    else if (frame.opcode === "Resize")
      resizeAndBroadcast(manager, broadcast, getActiveSessions, frame.slot, frame.cols, frame.rows);
  };
}
