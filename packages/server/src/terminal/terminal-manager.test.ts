import { decodeTerminalFrame, encodeTerminalFrame } from "@av-pi-studio/protocol";
import { describe, expect, it } from "vitest";

import type { PtyBackend, PtyProcess, PtySpawnOptions } from "./pty-backend.js";
import { safeReplayStart, TerminalManager } from "./terminal-manager.js";

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
  /** Simulates the PTY exiting on its own (the `exit` command, a crash) — unlike `kill()`, this
   * does not set `killed`, so a test can assert the manager took the self-exit path. */
  simulateExit(code: number | null = 0): void {
    this.exitCb?.(code);
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

  it("subscribing with restoreMode: reflowable yields exactly one Restore frame, never Snapshot", async () => {
    const backend = new FakePtyBackend();
    const mgr = new TerminalManager({ backend, coalesceMs: 1 });
    const entry = mgr.createTerminal({ workspaceId: "ws1" });
    backend.last().emit("\x1b[31mcolored\x1b[0m screen");
    await wait(5);

    const frames: ReturnType<typeof decodeTerminalFrame>[] = [];
    mgr.subscribe(entry.slot, (f) => frames.push(decodeTerminalFrame(f)), {
      restoreMode: "reflowable",
    });

    expect(frames).toHaveLength(1);
    expect(frames[0]!.opcode).toBe("Restore");
    if (frames[0]!.opcode === "Restore") {
      const text = new TextDecoder().decode(frames[0]!.data);
      expect(text).toContain("colored");
      expect(text).toContain("\x1b[31m"); // SGR colour survives, unlike the plain-text capture()
    }
  });

  it("subscribing with no restoreMode (or 'basic') still yields exactly one Snapshot, never Restore", () => {
    const backend = new FakePtyBackend();
    const mgr = new TerminalManager({ backend, coalesceMs: 0 });
    const entry = mgr.createTerminal({ workspaceId: "ws1" });

    const noOptFrames: ReturnType<typeof decodeTerminalFrame>[] = [];
    mgr.subscribe(entry.slot, (f) => noOptFrames.push(decodeTerminalFrame(f)));
    expect(noOptFrames).toHaveLength(1);
    expect(noOptFrames[0]!.opcode).toBe("Snapshot");

    const basicFrames: ReturnType<typeof decodeTerminalFrame>[] = [];
    mgr.subscribe(entry.slot, (f) => basicFrames.push(decodeTerminalFrame(f)), {
      restoreMode: "basic",
    });
    expect(basicFrames).toHaveLength(1);
    expect(basicFrames[0]!.opcode).toBe("Snapshot");
  });

  it("input frames reach the PTY", () => {
    const backend = new FakePtyBackend();
    const mgr = new TerminalManager({ backend, coalesceMs: 0 });
    const entry = mgr.createTerminal({ workspaceId: "ws1" });
    mgr.input(entry.slot, new TextEncoder().encode("ls\n"));
    expect(new TextDecoder().decode(backend.last().writes[0]!)).toBe("ls\n");
  });

  // Manager-level contract only: `manager.subscribe` never resizes as a side effect. The
  // `subscribe_terminal_request` *handler* does resize before calling this, when the attaching client
  // supplied a grid (see terminal-rpcs.test.ts) — that is the handler's decision, deliberately kept
  // out of here so attach and resize stay separable.
  it("subscribe() itself never resizes the PTY", () => {
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

  it("onTerminalExit fires exactly once when the PTY exits on its own (not via kill())", () => {
    const backend = new FakePtyBackend();
    const mgr = new TerminalManager({ backend, coalesceMs: 0 });
    const entry = mgr.createTerminal({ workspaceId: "ws1" });
    const exits: number[] = [];
    mgr.onTerminalExit((slot) => exits.push(slot));

    backend.last().simulateExit(0); // `exit` in the shell / a crash — never went through kill()

    expect(exits).toEqual([entry.slot]);
    expect(backend.last().killed).toBe(false); // proves this was the self-exit path
    expect(mgr.get(entry.slot)).toBeUndefined();
  });

  it("onTerminalExit fires exactly once for kill(), even though kill() also calls onExit directly", () => {
    const backend = new FakePtyBackend();
    const mgr = new TerminalManager({ backend, coalesceMs: 0 });
    const entry = mgr.createTerminal({ workspaceId: "ws1" });
    const exits: number[] = [];
    mgr.onTerminalExit((slot) => exits.push(slot));

    mgr.kill(entry.slot);

    expect(exits).toEqual([entry.slot]);
  });

  it("onTerminalExit unsubscribe stops further notifications", () => {
    const backend = new FakePtyBackend();
    const mgr = new TerminalManager({ backend, coalesceMs: 0 });
    const entry = mgr.createTerminal({ workspaceId: "ws1" });
    const exits: number[] = [];
    const unsubscribe = mgr.onTerminalExit((slot) => exits.push(slot));
    unsubscribe();

    mgr.kill(entry.slot);

    expect(exits).toEqual([]);
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

/** Concatenates byte-like parts (`Uint8Array`s or plain-number arrays) into one `Uint8Array`. */
function bytes(...parts: Array<Uint8Array | number[]>): Uint8Array {
  const arrays = parts.map((p) => (p instanceof Uint8Array ? p : new Uint8Array(p)));
  const total = arrays.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) {
    out.set(a, offset);
    offset += a.length;
  }
  return out;
}

describe("safeReplayStart", () => {
  const enc = new TextEncoder();
  const dec = new TextDecoder();

  it("returns `from` unchanged when it already lands on a safe (plain) byte", () => {
    const buf = enc.encode("hello world");
    expect(safeReplayStart(buf, 5)).toBe(5);
  });

  it("clamps to 0 / buffer.length for out-of-range offsets", () => {
    const buf = enc.encode("hello");
    expect(safeReplayStart(buf, 0)).toBe(0);
    expect(safeReplayStart(buf, -3)).toBe(0);
    expect(safeReplayStart(buf, buf.length)).toBe(buf.length);
    expect(safeReplayStart(buf, buf.length + 10)).toBe(buf.length);
  });

  it("skips past a CSI sequence's final byte when the cut lands inside it", () => {
    const prefix = enc.encode("AB");
    const csi = new Uint8Array([0x1b, 0x5b, 0x33, 0x32, 0x6d]); // ESC [ 3 2 m (SGR green)
    const suffix = enc.encode("CD");
    const buf = bytes(prefix, csi, suffix);
    const cut = prefix.length + 2; // lands on the "3" parameter byte
    const result = safeReplayStart(buf, cut);
    expect(result).toBe(prefix.length + csi.length);
    expect(dec.decode(buf.slice(result))).toBe("CD");
  });

  it("skips past an OSC sequence terminated by BEL", () => {
    const prefix = enc.encode("AB");
    const osc = bytes([0x1b, 0x5d], enc.encode("0;title"), [0x07]); // ESC ] 0;title BEL
    const suffix = enc.encode("CD");
    const buf = bytes(prefix, osc, suffix);
    const cut = prefix.length + 4; // inside "0;title"
    const result = safeReplayStart(buf, cut);
    expect(result).toBe(prefix.length + osc.length);
    expect(dec.decode(buf.slice(result))).toBe("CD");
  });

  it("skips past an OSC sequence terminated by ESC \\ (ST)", () => {
    const prefix = enc.encode("AB");
    const osc = bytes([0x1b, 0x5d], enc.encode("0;title"), [0x1b, 0x5c]); // ESC ] 0;title ESC \
    const suffix = enc.encode("CD");
    const buf = bytes(prefix, osc, suffix);
    const cut = prefix.length + 4;
    const result = safeReplayStart(buf, cut);
    expect(result).toBe(prefix.length + osc.length);
    expect(dec.decode(buf.slice(result))).toBe("CD");
  });

  it("skips past a DCS (device control string) sequence terminated by ST", () => {
    const prefix = enc.encode("AB");
    const dcs = bytes([0x1b, 0x50], enc.encode("1$q"), [0x1b, 0x5c]); // ESC P 1$q ESC \
    const suffix = enc.encode("CD");
    const buf = bytes(prefix, dcs, suffix);
    const cut = prefix.length + 3;
    const result = safeReplayStart(buf, cut);
    expect(result).toBe(prefix.length + dcs.length);
    expect(dec.decode(buf.slice(result))).toBe("CD");
  });

  it("skips past a two-byte ESC form when the cut lands on its classifying byte", () => {
    const prefix = enc.encode("AB");
    const escForm = new Uint8Array([0x1b, 0x3d]); // ESC = (DECKPAM), terminates on the 2nd byte
    const suffix = enc.encode("CD");
    const buf = bytes(prefix, escForm, suffix);
    const cut = prefix.length + 1; // lands on "="
    const result = safeReplayStart(buf, cut);
    expect(result).toBe(prefix.length + escForm.length);
    expect(dec.decode(buf.slice(result))).toBe("CD");
  });

  it("skips forward over a split UTF-8 continuation byte to the next full character", () => {
    const prefix = enc.encode("AB");
    const euro = enc.encode("€"); // 3 bytes: 0xE2 0x82 0xAC
    const suffix = enc.encode("CD");
    const buf = bytes(prefix, euro, suffix);
    const cut = prefix.length + 1; // lands on euro's 2nd byte (a continuation byte)
    const result = safeReplayStart(buf, cut);
    expect(result).toBe(prefix.length + euro.length);
    expect(dec.decode(buf.slice(result))).toBe("CD");
  });

  it("falls back to the naive cut (sprint-053/task-007) when no terminator appears in the remaining buffer", () => {
    const prefix = enc.encode("AB");
    const unterminatedOsc = bytes([0x1b, 0x5d], enc.encode("0;never terminated"));
    const buf = bytes(prefix, unterminatedOsc);
    const cut = prefix.length + 3;
    // Previously dropped everything (`buf.length`); now falls back to the naive cut instead —
    // strictly more readable than an empty snapshot, even though the cut lands mid-OSC.
    expect(safeReplayStart(buf, cut)).toBe(cut);
  });
});

describe("snapshot ring", () => {
  it("bounds the retained ring at an escape-safe boundary, not a raw byte offset", async () => {
    const backend = new FakePtyBackend();
    const mgr = new TerminalManager({ backend, coalesceMs: 0, snapshotBytes: 6 });
    const entry = mgr.createTerminal({ workspaceId: "ws1" });
    // "AB" + ESC[32m (5-byte CSI) + "CD" = 9 bytes. A raw 6-byte cut (offset 3) lands on the
    // CSI's "[" -- the escape-safe trim must skip the whole sequence instead of replaying its tail.
    backend.last().emit("AB\x1b[32mCD");
    await wait(2);

    const frames: ReturnType<typeof decodeTerminalFrame>[] = [];
    mgr.subscribe(entry.slot, (f) => frames.push(decodeTerminalFrame(f)));
    const snapshot = frames[0]!;
    expect(snapshot.opcode).toBe("Snapshot");
    if (snapshot.opcode === "Snapshot") {
      expect(new TextDecoder().decode(snapshot.data)).toBe("CD");
    }
  });

  it("keeps the ring within its cap across many small appends", async () => {
    const backend = new FakePtyBackend();
    const mgr = new TerminalManager({ backend, coalesceMs: 0, snapshotBytes: 64 });
    const entry = mgr.createTerminal({ workspaceId: "ws1" });
    // Escape-free bytes, so the only thing under test is the bound itself. Far more total output
    // than the cap, delivered in chunks small enough that compaction must happen repeatedly.
    for (let i = 0; i < 50; i++) backend.last().emit("0123456789");
    await wait(2);

    const frames: ReturnType<typeof decodeTerminalFrame>[] = [];
    mgr.subscribe(entry.slot, (f) => frames.push(decodeTerminalFrame(f)));
    const snapshot = frames[0]!;
    if (snapshot.opcode !== "Snapshot") throw new Error("expected a Snapshot frame");
    expect(snapshot.data.length).toBeLessThanOrEqual(64);
    // Retains the most recent bytes, not the oldest.
    const text = new TextDecoder().decode(snapshot.data);
    expect("0123456789".repeat(50).endsWith(text)).toBe(true);
  });

  it("replaces the ring wholesale when one chunk exceeds the cap", async () => {
    const backend = new FakePtyBackend();
    const mgr = new TerminalManager({ backend, coalesceMs: 0, snapshotBytes: 8 });
    const entry = mgr.createTerminal({ workspaceId: "ws1" });
    backend.last().emit("old");
    backend.last().emit("ABCDEFGHIJKLMNOP"); // 16 bytes into an 8-byte ring
    await wait(2);

    const frames: ReturnType<typeof decodeTerminalFrame>[] = [];
    mgr.subscribe(entry.slot, (f) => frames.push(decodeTerminalFrame(f)));
    const snapshot = frames[0]!;
    if (snapshot.opcode !== "Snapshot") throw new Error("expected a Snapshot frame");
    const text = new TextDecoder().decode(snapshot.data);
    expect(snapshot.data.length).toBeLessThanOrEqual(8);
    expect(text).toBe("KLMNOP");
    expect(text).not.toContain("old");
  });

  it("retains readable content instead of an empty snapshot when the ring's whole retained region is one unterminated sequence (sprint-053/task-007)", async () => {
    const backend = new FakePtyBackend();
    const mgr = new TerminalManager({ backend, coalesceMs: 0, snapshotBytes: 10 });
    const entry = mgr.createTerminal({ workspaceId: "ws1" });
    // A single chunk >= the 10-byte cap forces the wholesale-replace path in `append`. The chunk is
    // "AB" followed by an OSC (ESC ]) that never terminates (no BEL/ST) anywhere in the chunk, so
    // `safeReplayStart` cannot find any safe boundary and must fall back to the naive cut rather
    // than dropping the entire retained region to empty.
    backend.last().emit("AB\x1b]0;never terminated by BEL or ST, way beyond ring cap");
    await wait(2);

    const frames: ReturnType<typeof decodeTerminalFrame>[] = [];
    mgr.subscribe(entry.slot, (f) => frames.push(decodeTerminalFrame(f)));
    const snapshot = frames[0]!;
    if (snapshot.opcode !== "Snapshot") throw new Error("expected a Snapshot frame");
    // Previously this was empty (`data.length === 0`); now it retains the low-water tail.
    expect(snapshot.data.length).toBeGreaterThan(0);
    expect(new TextDecoder().decode(snapshot.data)).toBe("ing cap");
  });
});

describe("resize validation", () => {
  const validSetup = () => {
    const backend = new FakePtyBackend();
    const mgr = new TerminalManager({ backend, coalesceMs: 0 });
    const entry = mgr.createTerminal({ workspaceId: "ws1", cols: 100, rows: 40 });
    return { backend, mgr, entry };
  };

  // A binary `Resize` frame reaches `manager.resize` with whatever was on the wire — the manager is
  // the choke point that has to stop a hostile/malformed size before it hits a real PTY.
  it.each([
    ["zero cols", 0, 24],
    ["negative rows", 80, -5],
    ["NaN", Number.NaN, 24],
    ["Infinity", Number.POSITIVE_INFINITY, 24],
    ["fractional", 80.5, 24],
    ["absurdly large", 1e9, 24],
    ["below the 2-column floor", 1, 24],
  ])("rejects %s without touching the PTY", (_label, cols, rows) => {
    const { backend, mgr, entry } = validSetup();
    const pty = backend.last();
    const before = pty.resizes.length;

    expect(mgr.resize(entry.slot, cols, rows)).toBe(false);
    expect(pty.resizes.length).toBe(before);
    // The entry still describes the size the PTY actually has.
    expect(mgr.get(entry.slot)).toMatchObject({ cols: 100, rows: 40 });
  });

  it("applies a valid resize and reports it on the entry", () => {
    const { backend, mgr, entry } = validSetup();
    expect(mgr.resize(entry.slot, 190, 50)).toBe(true);
    expect(backend.last().resizes.at(-1)).toEqual({ cols: 190, rows: 50 });
    expect(mgr.get(entry.slot)).toMatchObject({ cols: 190, rows: 50 });
  });

  it("treats a same-size resize as a no-op so no SIGWINCH storm reaches the shell", () => {
    const { backend, mgr, entry } = validSetup();
    const pty = backend.last();
    const before = pty.resizes.length;
    expect(mgr.resize(entry.slot, 100, 40)).toBe(true);
    expect(pty.resizes.length).toBe(before);
  });

  it("rejects a resize for an unknown slot", () => {
    const { mgr } = validSetup();
    expect(mgr.resize(999, 80, 24)).toBe(false);
  });

  it("falls an invalid create-time grid back to 80x24 instead of failing the spawn", () => {
    const backend = new FakePtyBackend();
    const mgr = new TerminalManager({ backend, coalesceMs: 0 });
    const entry = mgr.createTerminal({ workspaceId: "ws1", cols: -1, rows: 1e9 });
    expect(entry).toMatchObject({ cols: 80, rows: 24 });
    expect(backend.last().opts).toMatchObject({ cols: 80, rows: 24 });
  });
});

// Sanity: the encode/decode round-trips used above are the protocol codec.
it("uses the protocol terminal codec", () => {
  const f = encodeTerminalFrame({ opcode: "Output", slot: 5, data: new Uint8Array([1, 2]) });
  expect(decodeTerminalFrame(f).slot).toBe(5);
});
