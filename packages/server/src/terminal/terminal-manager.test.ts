import { decodeTerminalFrame, encodeTerminalFrame } from "@av-pi-studio/protocol";
import { describe, expect, it } from "vitest";

import type { PtyBackend, PtyProcess, PtySpawnOptions } from "./pty-backend.js";
import { TerminalManager } from "./terminal-manager.js";

/** A controllable fake PTY backend recording writes/resizes and pushing output on demand. */
class FakePtyBackend implements PtyBackend {
  readonly ptys: FakePty[] = [];
  spawn(opts: PtySpawnOptions): PtyProcess {
    const pty = new FakePty(opts);
    this.ptys.push(pty);
    return pty;
  }
  last(): FakePty {
    return this.ptys[this.ptys.length - 1]!;
  }
}

class FakePty implements PtyProcess {
  writes: Uint8Array[] = [];
  resizes: Array<{ cols: number; rows: number }> = [];
  killed = false;
  private dataCb: ((d: Uint8Array) => void) | null = null;
  private exitCb: ((c: number | null) => void) | null = null;
  constructor(readonly opts: PtySpawnOptions) {}
  write(data: Uint8Array): void {
    this.writes.push(data);
  }
  resize(cols: number, rows: number): void {
    this.resizes.push({ cols, rows });
  }
  kill(): void {
    this.killed = true;
    this.exitCb?.(0);
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
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("TerminalManager", () => {
  it("creating a terminal spawns a PTY and assigns a slot", () => {
    const backend = new FakePtyBackend();
    const mgr = new TerminalManager({ backend, coalesceMs: 0 });
    const entry = mgr.createTerminal({ workspaceId: "ws1", cwd: "/work" });
    expect(entry.slot).toBe(1);
    expect(backend.ptys).toHaveLength(1);
    expect(mgr.list()).toHaveLength(1);
    // A second terminal gets a distinct slot.
    expect(mgr.createTerminal({ workspaceId: "ws1" }).slot).toBe(2);
  });

  it("subscribing yields a Snapshot frame followed by live Output frames", async () => {
    const backend = new FakePtyBackend();
    const mgr = new TerminalManager({ backend, coalesceMs: 1 });
    const entry = mgr.createTerminal({ workspaceId: "ws1" });
    backend.last().emit("existing screen "); // becomes part of the snapshot
    await wait(5);

    const frames: ReturnType<typeof decodeTerminalFrame>[] = [];
    mgr.subscribe(entry.slot, (f) => frames.push(decodeTerminalFrame(f)));

    // First frame on subscribe is the Snapshot (current screen).
    expect(frames[0]!.opcode).toBe("Snapshot");
    if (frames[0]!.opcode === "Snapshot") {
      expect(new TextDecoder().decode(frames[0]!.data)).toContain("existing screen");
    }

    // Live output afterwards arrives as coalesced Output frames.
    backend.last().emit("hello ");
    backend.last().emit("world");
    await wait(5);
    const outputs = frames.filter((f) => f.opcode === "Output");
    expect(outputs.length).toBeGreaterThanOrEqual(1);
    const text = outputs
      .map((f) => (f.opcode === "Output" ? new TextDecoder().decode(f.data) : ""))
      .join("");
    expect(text).toContain("hello world"); // coalesced
  });

  it("input frames reach the PTY", () => {
    const backend = new FakePtyBackend();
    const mgr = new TerminalManager({ backend, coalesceMs: 0 });
    const entry = mgr.createTerminal({ workspaceId: "ws1" });
    mgr.input(entry.slot, new TextEncoder().encode("ls\n"));
    expect(new TextDecoder().decode(backend.last().writes[0]!)).toBe("ls\n");
  });

  it("a passive re-attach (subscribe) does NOT resize the PTY", () => {
    const backend = new FakePtyBackend();
    const mgr = new TerminalManager({ backend, coalesceMs: 0 });
    const entry = mgr.createTerminal({ workspaceId: "ws1" });
    mgr.subscribe(entry.slot, () => {});
    mgr.subscribe(entry.slot, () => {}); // second attach
    expect(backend.last().resizes).toHaveLength(0);
    // Only an explicit resize claims size.
    mgr.resize(entry.slot, 120, 40);
    expect(backend.last().resizes).toEqual([{ cols: 120, rows: 40 }]);
  });

  it("two clients of different sizes both receive output (no server-side resize broadcast)", async () => {
    const backend = new FakePtyBackend();
    const mgr = new TerminalManager({ backend, coalesceMs: 1 });
    const entry = mgr.createTerminal({ workspaceId: "ws1" });
    const a: string[] = [];
    const b: string[] = [];
    mgr.subscribe(entry.slot, (f) => {
      const d = decodeTerminalFrame(f);
      if (d.opcode === "Output") a.push(new TextDecoder().decode(d.data));
    });
    mgr.subscribe(entry.slot, (f) => {
      const d = decodeTerminalFrame(f);
      if (d.opcode === "Output") b.push(new TextDecoder().decode(d.data));
    });
    // Client A resizes; this must not produce any broadcast to B.
    mgr.resize(entry.slot, 100, 30);
    backend.last().emit("shared output");
    await wait(5);
    expect(a.join("")).toContain("shared output");
    expect(b.join("")).toContain("shared output");
  });

  it("capture returns current screen text without subscribing", async () => {
    const backend = new FakePtyBackend();
    const mgr = new TerminalManager({ backend, coalesceMs: 0 });
    const entry = mgr.createTerminal({ workspaceId: "ws1" });
    backend.last().emit("captured content");
    await wait(2);
    expect(mgr.capture(entry.slot)).toContain("captured content");
  });

  it("kill terminates the PTY and removes the entry", () => {
    const backend = new FakePtyBackend();
    const mgr = new TerminalManager({ backend, coalesceMs: 0 });
    const entry = mgr.createTerminal({ workspaceId: "ws1" });
    expect(mgr.kill(entry.slot)).toBe(true);
    expect(backend.ptys[0]!.killed).toBe(true);
    expect(mgr.get(entry.slot)).toBeUndefined();
  });

  it("logs open, kill and exit lifecycle to the injected logger", () => {
    const records: Array<{ level: string; msg?: string; [k: string]: unknown }> = [];
    const capture = (level: string) => (obj: unknown, msg?: string) => {
      records.push(
        typeof obj === "string" ? { level, msg: obj } : { level, ...(obj as object), msg },
      );
    };
    const logger = {
      trace: capture("trace"),
      debug: capture("debug"),
      info: capture("info"),
      warn: capture("warn"),
      error: capture("error"),
      fatal: capture("fatal"),
      child: () => logger,
    };
    const backend = new FakePtyBackend();
    const mgr = new TerminalManager({ backend, coalesceMs: 0, logger });
    const entry = mgr.createTerminal({ workspaceId: "ws1", cwd: "/work" });
    mgr.kill(entry.slot);

    const opened = records.find((r) => r.msg === "terminal opened");
    expect(opened).toMatchObject({ level: "info", slot: 1, workspaceId: "ws1", cwd: "/work" });
    expect(records.find((r) => r.msg === "terminal kill requested")).toMatchObject({
      level: "info",
      slot: 1,
    });
    expect(records.find((r) => r.msg === "terminal exited")).toMatchObject({
      level: "info",
      slot: 1,
    });
  });

  it("logs spawn failures at error and rethrows", () => {
    const records: Array<{ level: string; msg?: string; [k: string]: unknown }> = [];
    const capture = (level: string) => (obj: unknown, msg?: string) => {
      records.push(
        typeof obj === "string" ? { level, msg: obj } : { level, ...(obj as object), msg },
      );
    };
    const logger = {
      trace: capture("trace"),
      debug: capture("debug"),
      info: capture("info"),
      warn: capture("warn"),
      error: capture("error"),
      fatal: capture("fatal"),
      child: () => logger,
    };
    const failingBackend: PtyBackend = {
      spawn: () => {
        throw new Error("pty unavailable");
      },
    };
    const mgr = new TerminalManager({ backend: failingBackend, coalesceMs: 0, logger });
    expect(() => mgr.createTerminal({ workspaceId: "ws1", shell: "/bin/sh" })).toThrow(
      "pty unavailable",
    );
    expect(records.find((r) => r.msg === "terminal spawn failed")).toMatchObject({
      level: "error",
      shell: "/bin/sh",
      err: "pty unavailable",
    });
  });

  it("recycles the slots of exited terminals instead of counting past the one-byte space", () => {
    // The terminal frame header spends one byte on the slot, so `nextSlot++` handed the 256th
    // terminal ever opened a slot of 256 and `encodeTerminalFrame` threw on every frame for it —
    // terminals stayed broken until the daemon restarted.
    const backend = new FakePtyBackend();
    const mgr = new TerminalManager({ backend, coalesceMs: 0 });

    for (let i = 0; i < 300; i++) {
      const entry = mgr.createTerminal({ workspaceId: "ws1" });
      expect(entry.slot).toBeGreaterThanOrEqual(0);
      expect(entry.slot).toBeLessThan(256);
      // Encoding a frame for the assigned slot is the exact operation that used to throw.
      expect(() =>
        encodeTerminalFrame({ opcode: "Output", slot: entry.slot, data: new Uint8Array([1]) }),
      ).not.toThrow();
      mgr.kill(entry.slot);
    }
    expect(mgr.list()).toHaveLength(0);
  });

  it("keeps concurrently live terminals on distinct slots", () => {
    const backend = new FakePtyBackend();
    const mgr = new TerminalManager({ backend, coalesceMs: 0 });
    const slots = new Set<number>();
    for (let i = 0; i < 256; i++) slots.add(mgr.createTerminal({ workspaceId: "ws1" }).slot);
    expect(slots.size).toBe(256);
    expect(() => mgr.createTerminal({ workspaceId: "ws1" })).toThrow("no free terminal slot");
  });
});

// Sanity: the encode/decode round-trips used above are the protocol codec.
it("uses the protocol terminal codec", () => {
  const f = encodeTerminalFrame({ opcode: "Output", slot: 5, data: new Uint8Array([1, 2]) });
  expect(decodeTerminalFrame(f).slot).toBe(5);
});
