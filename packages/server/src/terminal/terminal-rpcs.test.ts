import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { decodeTerminalFrame } from "@av-pi-studio/protocol";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { HandlerRegistry, type RpcHandler } from "../ws/router.js";
import { Session } from "../ws/session.js";
import type { PtyBackend, PtyProcess, PtySpawnOptions } from "./pty-backend.js";
import { TerminalManager } from "./terminal-manager.js";
import { registerTerminalHandlers } from "./terminal-rpc.js";

class FakePty implements PtyProcess {
  writes: Uint8Array[] = [];
  private dataCb: ((d: Uint8Array) => void) | null = null;
  constructor(readonly opts: PtySpawnOptions) {}
  write(d: Uint8Array): void {
    this.writes.push(d);
  }
  resize(): void {}
  kill(): void {}
  onData(cb: (d: Uint8Array) => void): void {
    this.dataCb = cb;
  }
  onExit(): void {}
  emit(text: string): void {
    this.dataCb?.(new TextEncoder().encode(text));
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
  sessions: Session[];
} {
  const backend = new FakeBackend();
  const manager = new TerminalManager({ backend, coalesceMs: 1 });
  const registry = new HandlerRegistry();
  const broadcasts: unknown[] = [];
  const sessions: Session[] = [];
  registerTerminalHandlers(
    registry,
    {
      manager,
      broadcast: (_s, m) => broadcasts.push(m),
      restoreModesEnabled: opts.restoreModesEnabled ?? true,
      projectConfigPath: opts.projectConfigPath ?? ((cwd) => join(cwd, "pi-studio.json")),
    },
    () => sessions,
  );
  return { registry, manager, backend, broadcasts, sessions };
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
});

describe("restore-mode gating", () => {
  it("honors restoreMode when the feature + client capability are present", async () => {
    const { registry } = setup({ restoreModesEnabled: true });
    const { session: creator } = makeSession("c");
    const created = await call(registry, creator, {
      type: "create_terminal_request",
      workspaceId: "ws1",
    });
    const slot = (created!.terminal as { slot: number }).slot;

    const { session } = makeSession("s", { terminal_reflowable_snapshot: true });
    const res = await call(registry, session, {
      type: "subscribe_terminal_request",
      slot,
      restoreMode: "reflow",
    });
    expect(res!.restoreMode).toBe("reflow");
  });

  it("an old client without restore-modes falls back to basic snapshot", async () => {
    // Daemon advertises the feature, but the client did NOT advertise the reflowable capability.
    const { registry } = setup({ restoreModesEnabled: true });
    const { session: creator } = makeSession("c");
    const created = await call(registry, creator, {
      type: "create_terminal_request",
      workspaceId: "ws1",
    });
    const slot = (created!.terminal as { slot: number }).slot;

    const { session } = makeSession("old"); // no capabilities
    const res = await call(registry, session, {
      type: "subscribe_terminal_request",
      slot,
      restoreMode: "reflow",
    });
    expect(res!.restoreMode).toBe("basic"); // requested mode ignored
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
