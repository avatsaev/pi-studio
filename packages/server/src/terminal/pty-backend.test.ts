import { describe, expect, it, vi } from "vitest";

import {
  ChildProcessPtyBackend,
  createDefaultPtyBackend,
  NodePtyBackend,
  resolveExecutable,
} from "./pty-backend.js";

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe("resolveExecutable", () => {
  it("resolves a bare command name on $PATH to an absolute path", () => {
    const resolved = resolveExecutable("sh");
    expect(resolved.startsWith("/")).toBe(true);
    expect(resolved).toContain("sh");
  });

  it("returns path-like inputs unchanged", () => {
    expect(resolveExecutable("/bin/sh")).toBe("/bin/sh");
    expect(resolveExecutable("./local")).toBe("./local");
  });

  it("returns the input unchanged when not resolvable", () => {
    expect(resolveExecutable("definitely-not-a-real-binary-xyz")).toBe(
      "definitely-not-a-real-binary-xyz",
    );
  });
});

describe("NodePtyBackend (real TTY)", () => {
  it("spawns a process attached to a real PTY (isatty is true)", async () => {
    const backend = createDefaultPtyBackend();
    expect(backend).toBeInstanceOf(NodePtyBackend);

    const proc = backend.spawn({
      shell: "sh",
      args: ["-c", "tty >/dev/null 2>&1 && echo HAS_TTY || echo NO_TTY"],
      cols: 80,
      rows: 24,
    });

    const output = await new Promise<string>((resolve) => {
      let buf = "";
      proc.onData((d) => {
        buf += new TextDecoder().decode(d);
      });
      proc.onExit(() => resolve(buf));
    });

    // The whole reason for node-pty: the child sees a controlling terminal.
    expect(output).toContain("HAS_TTY");
  });

  it("delivers a resize without throwing and exits cleanly", async () => {
    const backend = new NodePtyBackend();
    const proc = backend.spawn({ shell: "sh", args: ["-c", "sleep 0.1"], cols: 80, rows: 24 });
    expect(() => proc.resize(120, 40)).not.toThrow();
    await new Promise<void>((resolve) => proc.onExit(() => resolve()));
  });
});

describe("PtyProcess.kill", () => {
  // A process that ignores SIGHUP (`nohup`) outlives a shell that dies first: the tree must be
  // signalled before the shell is, or the walk finds nothing and the daemon's stop leaves it behind.
  it.each([
    ["NodePtyBackend", new NodePtyBackend()],
    ["ChildProcessPtyBackend", new ChildProcessPtyBackend()],
  ])("%s: a descendant that ignores SIGHUP is stopped with its shell", async (_name, backend) => {
    const proc = backend.spawn({
      shell: "sh",
      args: ["-c", "nohup sleep 60 >/dev/null 2>&1 & echo CHILD:$!; wait"],
      cols: 80,
      rows: 24,
    });
    let output = "";
    proc.onData((d) => {
      output += new TextDecoder().decode(d);
    });
    const exited = new Promise<void>((resolve) => proc.onExit(() => resolve()));
    await vi.waitFor(() => expect(output).toMatch(/CHILD:\d+/), { timeout: 5000 });
    const child = Number(/CHILD:(\d+)/.exec(output)![1]);
    try {
      expect(isAlive(child)).toBe(true);
      proc.kill(false);
      await exited;
      await vi.waitFor(() => expect(isAlive(child)).toBe(false), { timeout: 5000 });
    } finally {
      if (isAlive(child)) process.kill(child, "SIGKILL");
    }
  });
});
