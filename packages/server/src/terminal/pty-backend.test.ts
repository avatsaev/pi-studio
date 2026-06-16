import { describe, expect, it } from "vitest";

import { createDefaultPtyBackend, NodePtyBackend, resolveExecutable } from "./pty-backend.js";

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
