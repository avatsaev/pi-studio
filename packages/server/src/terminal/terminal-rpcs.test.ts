import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { decodeTerminalFrame, encodeTerminalFrame } from "@av-pi-studio/protocol";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { HandlerRegistry, type RpcHandler } from "../ws/router.js";
import { Session } from "../ws/session.js";
import type { PtyBackend, PtyProcess, PtySpawnOptions } from "./pty-backend.js";
import { TerminalManager } from "./terminal-manager.js";
import { makeTerminalBinaryHandler, registerTerminalHandlers } from "./terminal-rpc.js";

class FakePty implements PtyProcess {
  writes: Uint8Array[] = [];
  killed = false;
  private dataCb: ((d: Uint8Array) => void) | null = null;
  private exitCb: ((c: number | null) => void) | null = null;
  constructor(readonly opts: PtySpawnOptions) {}
  write(d: Uint8Array): void {
    this.writes.push(d);
  }
  resizes: { cols: number; rows: number }[] = [];
  resize(cols: number, rows: number): void {
    this.resizes.push({ cols, rows });
  }
  kill(): void {
    this.killed = true;
  }
  onData(cb: (d: Uint8Array) => void): void {
    this.dataCb = cb;
  }
  onExit(cb: (c: number | null) => void): void {
    this.exitCb = cb;
  }
  emit(text: string): void {
    this.dataCb?.(new TextEncoder().encode(text));
  }
  /** Simulates the PTY exiting on its own (the `exit` command, a crash) — unlike `kill()`. */
  simulateExit(code: number | null = 0): void {
    this.exitCb?.(code);
  }
}
class FakeBackend implements PtyBackend {
  ptys: FakePty[] = [];
  spawn(opts: PtySpawnOptions): PtyProcess {
    const p = new FakePty(opts);
    this.ptys.push(p);
    return p;
  }
}

/** Narrow a `create_terminal_response`'s slot without asserting a fabricated shape. */
function createdSlot(res: Record<string, unknown> | undefined): number {
  const terminal = res?.terminal;
  if (terminal && typeof terminal === "object" && "slot" in terminal) {
    const slot = terminal.slot;
    if (typeof slot === "number") return slot;
  }
  throw new Error("create_terminal_response did not carry a numeric slot");
}

/** A Session backed by a fake socket capturing text + binary sends. */
function makeSession(
  id: string,
  capabilities: Record<string, boolean> = {},
): {
  session: Session;
  text: unknown[];
  binary: Uint8Array[];
} {
  const text: unknown[] = [];
  const binary: Uint8Array[] = [];
  const socket = {
    send: (data: unknown) => {
      if (typeof data === "string") text.push(JSON.parse(data));
      else binary.push(data as Uint8Array);
    },
    close: () => {},
  };
  const session = new Session({
    id,
    clientId: `c-${id}`,
    clientType: "cli",
    capabilities,
    socket: socket as never,
  });
  return { session, text, binary };
}

function setup(
  opts: { restoreModesEnabled?: boolean; projectConfigPath?: (cwd: string) => string } = {},
): {
  registry: HandlerRegistry;
  manager: TerminalManager;
  backend: FakeBackend;
  broadcasts: unknown[];
  broadcast: (sessions: Iterable<Session>, message: unknown) => void;
  sessions: Session[];
} {
  const backend = new FakeBackend();
  const manager = new TerminalManager({ backend, coalesceMs: 1 });
  const registry = new HandlerRegistry();
  const broadcasts: unknown[] = [];
  const sessions: Session[] = [];
  const broadcast = (_s: Iterable<Session>, m: unknown) => broadcasts.push(m);
  registerTerminalHandlers(
    registry,
    {
      manager,
      broadcast,
      restoreModesEnabled: opts.restoreModesEnabled ?? true,
      projectConfigPath: opts.projectConfigPath ?? ((cwd) => join(cwd, "pi-studio.json")),
    },
    () => sessions,
  );
  return { registry, manager, backend, broadcasts, broadcast, sessions };
}

async function call(
  registry: HandlerRegistry,
  session: Session,
  message: Record<string, unknown>,
): Promise<Record<string, unknown> | undefined> {
  const handler = registry.get(message.type as string) as RpcHandler;
  return (await handler({ session, message, requestId: "r1" })) as
    | Record<string, unknown>
    | undefined;
}

describe("terminal lifecycle RPCs", () => {
  it("list/create/rename/kill mutate manager state", async () => {
    const { registry, manager } = setup();
    const { session } = makeSession("s1");

    const created = await call(registry, session, {
      type: "create_terminal_request",
      workspaceId: "ws1",
    });
    const slot = (created!.terminal as { slot: number }).slot;
    expect(manager.list()).toHaveLength(1);

    const renamed = await call(registry, session, {
      type: "rename_terminal_request",
      slot,
      name: "build",
    });
    expect(renamed!.ok).toBe(true);
    expect(manager.get(slot)!.name).toBe("build");

    const list = await call(registry, session, { type: "list_terminals_request" });
    expect((list!.terminals as unknown[]).length).toBe(1);

    const killed = await call(registry, session, { type: "kill_terminal_request", slot });
    expect(killed!.ok).toBe(true);
    expect(manager.list()).toHaveLength(0);
  });

  it("a self-exiting PTY broadcasts terminals_update to every active session, exactly once", async () => {
    const { registry, backend, broadcasts, sessions } = setup();
    const { session } = makeSession("s1");
    sessions.push(session);
    const created = await call(registry, session, {
      type: "create_terminal_request",
      workspaceId: "ws1",
    });
    void createdSlot(created); // validates the response shape; slot itself is not needed here
    broadcasts.length = 0; // drop the create broadcast; only the exit matters here

    backend.ptys[0]!.simulateExit(0); // `exit` in the shell — no RPC call at all

    expect(broadcasts).toHaveLength(1);
    expect(broadcasts[0]).toMatchObject({ type: "terminals_update" });
    expect((broadcasts[0] as { terminals: unknown[] }).terminals).toHaveLength(0);
  });

  it("kill_terminal_request broadcasts terminals_update exactly once, not twice", async () => {
    const { registry, broadcasts } = setup();
    const { session } = makeSession("s1");
    const created = await call(registry, session, {
      type: "create_terminal_request",
      workspaceId: "ws1",
    });
    const slot = createdSlot(created);
    broadcasts.length = 0; // drop the create broadcast; only the kill matters here

    const killed = await call(registry, session, { type: "kill_terminal_request", slot });

    expect(killed!.ok).toBe(true);
    expect(broadcasts).toHaveLength(1);
    expect(broadcasts[0]).toMatchObject({ type: "terminals_update" });
  });

  it("capture returns current screen text without subscribing", async () => {
    const { registry, backend } = setup();
    const { session } = makeSession("s1");
    const created = await call(registry, session, {
      type: "create_terminal_request",
      workspaceId: "ws1",
    });
    const slot = (created!.terminal as { slot: number }).slot;
    backend.ptys[0]!.emit("hello capture");
    await new Promise((r) => setTimeout(r, 3));
    const cap = await call(registry, session, { type: "capture_terminal_request", slot });
    expect(cap!.ok).toBe(true);
    expect(cap!.screen).toContain("hello capture");
  });

  it("subscribe pipes a binary Snapshot frame to the session", async () => {
    const { registry } = setup();
    const created = await (async () => {
      const { session } = makeSession("creator");
      return call(registry, session, { type: "create_terminal_request", workspaceId: "ws1" });
    })();
    const slot = (created!.terminal as { slot: number }).slot;

    const { session, binary } = makeSession("sub", { terminal_reflowable_snapshot: true });
    const res = await call(registry, session, { type: "subscribe_terminal_request", slot });
    expect(res!.ok).toBe(true);
    expect(binary).toHaveLength(1);
    expect(decodeTerminalFrame(binary[0]!).opcode).toBe("Snapshot");
  });

  // Regression (sprint-052): the Snapshot is a raw byte ring, so it reproduces the wrapping and
  // absolute cursor positioning of the width the PTY had when those bytes were written. A
  // full-screen app's 80-column paint replayed into a much wider emulator renders scrambled, and a
  // client-side Resize sent AFTER attaching cannot prevent it — `subscribe` emits the snapshot
  // synchronously, so the mangled bytes are already gone. The resize must land first.
  it("resizes the PTY before emitting the Snapshot when the subscriber sends a grid", async () => {
    const { registry, manager, backend } = setup();
    const { session: creator } = makeSession("creator");
    const created = await call(registry, creator, {
      type: "create_terminal_request",
      workspaceId: "ws1",
      cols: 80,
      rows: 24,
    });
    const slot = createdSlot(created);
    const pty = backend.ptys[0]!;
    const resizesBeforeSubscribe = pty.resizes.length;

    const { session, binary } = makeSession("sub");
    const res = await call(registry, session, {
      type: "subscribe_terminal_request",
      slot,
      cols: 190,
      rows: 50,
    });

    expect(res!.ok).toBe(true);
    // The PTY actually resized...
    expect(pty.resizes.length).toBe(resizesBeforeSubscribe + 1);
    expect(pty.resizes.at(-1)).toEqual({ cols: 190, rows: 50 });
    // ...and the manager's entry reflects it, so the echo below is the real size.
    expect(manager.list().find((t) => t.slot === slot)).toMatchObject({ cols: 190, rows: 50 });
    // ...and the snapshot still arrived (ordering, not replacement).
    expect(binary).toHaveLength(1);
    expect(decodeTerminalFrame(binary[0]!).opcode).toBe("Snapshot");
    // The response echoes the PTY's real size so the client can seed its belief.
    expect(res).toMatchObject({ cols: 190, rows: 50 });
  });

  it("echoes the PTY's size without resizing when the subscriber sends no grid", async () => {
    const { registry, backend } = setup();
    const { session: creator } = makeSession("creator");
    const created = await call(registry, creator, {
      type: "create_terminal_request",
      workspaceId: "ws1",
      cols: 100,
      rows: 30,
    });
    const slot = createdSlot(created);
    const pty = backend.ptys[0]!;
    const before = pty.resizes.length;

    // A hidden panel measures 0×0 and sends nothing — it must not resize what it only watches
    // (`terminals.md` § PTY size ownership), but it still needs to learn what it attached to.
    const { session } = makeSession("sub");
    const res = await call(registry, session, { type: "subscribe_terminal_request", slot });

    expect(res!.ok).toBe(true);
    expect(pty.resizes.length).toBe(before);
    expect(res).toMatchObject({ cols: 100, rows: 30 });
  });

  it("ignores a non-positive or non-integer grid from a subscriber", async () => {
    const { registry, backend } = setup();
    const { session: creator } = makeSession("creator");
    const created = await call(registry, creator, {
      type: "create_terminal_request",
      workspaceId: "ws1",
      cols: 100,
      rows: 30,
    });
    const slot = createdSlot(created);
    const pty = backend.ptys[0]!;
    const before = pty.resizes.length;

    const { session } = makeSession("sub");
    await call(registry, session, {
      type: "subscribe_terminal_request",
      slot,
      cols: 0,
      rows: 30,
    });
    await call(registry, session, {
      type: "subscribe_terminal_request",
      slot,
      cols: 80.5,
      rows: 24,
    });

    expect(pty.resizes.length).toBe(before);
  });

  // The binary `Resize` frame path is the one every real pane drag uses, and it reaches
  // `manager.resize` with whatever was decoded off the wire — no RPC-level coercion in front of it.
  // A malformed size must be rejected there rather than reaching `node-pty`/the headless grid, and
  // must never throw out of the frame handler (that would take down the whole frame dispatcher).
  it("rejects a malformed grid arriving as a binary Resize frame, and broadcasts only for a real change", async () => {
    const { registry, manager, backend, broadcasts, broadcast, sessions } = setup();
    const { session } = makeSession("s1");
    const created = await call(registry, session, {
      type: "create_terminal_request",
      workspaceId: "ws1",
      cols: 100,
      rows: 30,
    });
    const slot = createdSlot(created);
    const pty = backend.ptys[0]!;
    const before = pty.resizes.length;
    const broadcastsBefore = broadcasts.length; // create_terminal_request already broadcast once
    const handler = makeTerminalBinaryHandler(manager, broadcast, () => sessions);

    for (const [cols, rows] of [
      [0, 24],
      [1, 24],
      [90000, 24],
      [80, 0],
    ]) {
      expect(() =>
        handler(session, encodeTerminalFrame({ opcode: "Resize", slot, cols: cols!, rows: rows! })),
      ).not.toThrow();
    }

    expect(pty.resizes.length).toBe(before);
    expect(manager.get(slot)).toMatchObject({ cols: 100, rows: 30 });
    expect(broadcasts.length).toBe(broadcastsBefore); // rejected grids never broadcast

    // A well-formed frame on the same path still applies, and broadcasts once.
    handler(session, encodeTerminalFrame({ opcode: "Resize", slot, cols: 190, rows: 50 }));
    expect(pty.resizes.at(-1)).toEqual({ cols: 190, rows: 50 });
    expect(broadcasts.length).toBe(broadcastsBefore + 1);
  });

  it("broadcasts terminals_update exactly once for a size-changing binary Resize frame, and not at all for a same-size one", async () => {
    const { registry, manager, broadcasts, broadcast, sessions } = setup();
    const { session } = makeSession("s1");
    const created = await call(registry, session, {
      type: "create_terminal_request",
      workspaceId: "ws1",
      cols: 100,
      rows: 30,
    });
    const slot = createdSlot(created);
    const handler = makeTerminalBinaryHandler(manager, broadcast, () => sessions);
    const before = broadcasts.length; // create_terminal_request already broadcast once

    // Same-size resize: no additional broadcast (hot path of every coalesced drag frame).
    handler(session, encodeTerminalFrame({ opcode: "Resize", slot, cols: 100, rows: 30 }));
    expect(broadcasts.length).toBe(before);

    // A real size change: exactly one broadcast, carrying the new size.
    handler(session, encodeTerminalFrame({ opcode: "Resize", slot, cols: 190, rows: 50 }));
    expect(broadcasts.length).toBe(before + 1);
    expect(manager.get(slot)).toMatchObject({ cols: 190, rows: 50 });

    // A second same-size (now 190x50) frame still adds nothing.
    handler(session, encodeTerminalFrame({ opcode: "Resize", slot, cols: 190, rows: 50 }));
    expect(broadcasts.length).toBe(before + 1);
  });

  it("broadcasts terminals_update once when subscribe_terminal_request carries a differing grid", async () => {
    const { registry, manager, broadcasts } = setup();
    const { session } = makeSession("s1");
    const created = await call(registry, session, {
      type: "create_terminal_request",
      workspaceId: "ws1",
      cols: 100,
      rows: 30,
    });
    const slot = createdSlot(created);
    const before = broadcasts.length; // create_terminal_request already broadcast once

    await call(registry, session, {
      type: "subscribe_terminal_request",
      slot,
      cols: 190,
      rows: 50,
    });
    expect(broadcasts.length).toBe(before + 1);
    expect(manager.get(slot)).toMatchObject({ cols: 190, rows: 50 });

    // Re-subscribing at the same grid adds no further broadcast.
    await call(registry, session, {
      type: "subscribe_terminal_request",
      slot,
      cols: 190,
      rows: 50,
    });
    expect(broadcasts.length).toBe(before + 1);
  });
});

describe("restore-mode gating", () => {
  it("honors restoreMode when the feature + client capability are present: Restore frame, no Snapshot", async () => {
    const { registry } = setup({ restoreModesEnabled: true });
    const { session: creator } = makeSession("c");
    const created = await call(registry, creator, {
      type: "create_terminal_request",
      workspaceId: "ws1",
    });
    const slot = (created!.terminal as { slot: number }).slot;

    const { session, binary } = makeSession("s", { terminal_reflowable_snapshot: true });
    const res = await call(registry, session, {
      type: "subscribe_terminal_request",
      slot,
      restoreMode: "reflowable",
    });
    expect(res!.restoreMode).toBe("reflowable");
    expect(binary).toHaveLength(1);
    expect(decodeTerminalFrame(binary[0]!).opcode).toBe("Restore");
  });

  it("an old client without restore-modes falls back to basic snapshot: Snapshot frame, no Restore", async () => {
    // Daemon advertises the feature, but the client did NOT advertise the reflowable capability.
    const { registry } = setup({ restoreModesEnabled: true });
    const { session: creator } = makeSession("c");
    const created = await call(registry, creator, {
      type: "create_terminal_request",
      workspaceId: "ws1",
    });
    const slot = (created!.terminal as { slot: number }).slot;

    const { session, binary } = makeSession("old"); // no capabilities
    const res = await call(registry, session, {
      type: "subscribe_terminal_request",
      slot,
      restoreMode: "reflowable",
    });
    expect(res!.restoreMode).toBe("basic"); // requested mode ignored — no capability
    expect(binary).toHaveLength(1);
    expect(decodeTerminalFrame(binary[0]!).opcode).toBe("Snapshot");
  });

  it("the daemon feature being disabled falls back to basic even for an eligible client", async () => {
    const { registry } = setup({ restoreModesEnabled: false });
    const { session: creator } = makeSession("c");
    const created = await call(registry, creator, {
      type: "create_terminal_request",
      workspaceId: "ws1",
    });
    const slot = (created!.terminal as { slot: number }).slot;

    const { session, binary } = makeSession("s", { terminal_reflowable_snapshot: true });
    const res = await call(registry, session, {
      type: "subscribe_terminal_request",
      slot,
      restoreMode: "reflowable",
    });
    expect(res!.restoreMode).toBe("basic");
    expect(decodeTerminalFrame(binary[0]!).opcode).toBe("Snapshot");
  });

  // Regression (sprint-053/task-004): the negotiation used to pass through whatever string the
  // client sent verbatim (`requestedMode ?? "basic"`), so a typo'd/future value like "reflow"
  // would be echoed back as-is while actually being served the basic tier underneath — the
  // response would name a tier the subscriber never got.
  it("an unrecognized restoreMode value is served AND echoed as basic, never named verbatim", async () => {
    const { registry } = setup({ restoreModesEnabled: true });
    const { session: creator } = makeSession("c");
    const created = await call(registry, creator, {
      type: "create_terminal_request",
      workspaceId: "ws1",
    });
    const slot = (created!.terminal as { slot: number }).slot;

    const { session, binary } = makeSession("s", { terminal_reflowable_snapshot: true });
    const res = await call(registry, session, {
      type: "subscribe_terminal_request",
      slot,
      restoreMode: "reflow", // not the real wire literal
    });
    expect(res!.restoreMode).toBe("basic");
    expect(decodeTerminalFrame(binary[0]!).opcode).toBe("Snapshot");
  });
});

describe("StartWorkspaceScriptRequest", () => {
  let cwd: string;
  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "pi-studio-script-"));
    await writeFile(
      join(cwd, "pi-studio.json"),
      JSON.stringify({
        scripts: {
          dev: { type: "service", command: "node server.js" },
          lint: { command: "eslint ." },
        },
      }),
    );
  });
  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  it("starts a pi-studio.json script as a terminal and flags service scripts", async () => {
    const { registry, manager } = setup();
    const { session } = makeSession("s1");
    const res = await call(registry, session, {
      type: "start_workspace_script_request",
      workspaceId: "ws1",
      cwd,
      script: "dev",
    });
    expect(res!.ok).toBe(true);
    expect(res!.service).toBe(true); // service script flagged for the proxy
    expect(manager.list()).toHaveLength(1);
    expect(manager.list()[0]!.service).toBe(true);

    const missing = await call(registry, session, {
      type: "start_workspace_script_request",
      cwd,
      script: "nope",
    });
    expect(missing!.ok).toBe(false);
    expect(missing!.error).toBe("script_not_found");
  });
});
