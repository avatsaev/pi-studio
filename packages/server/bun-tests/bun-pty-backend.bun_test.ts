// Run with Bun, never Vitest (the file name matches Bun's `*_test.ts` pattern, not Vitest's
// include globs, and it lives outside `src/` so `tsc -b` skips it):
//   npx bun test packages/server/bun-tests/bun-pty-backend.bun_test.ts
import { describe, expect, it } from "bun:test";

import { BunPtyBackend } from "../src/terminal/bun-pty-backend.js";
import type { PtyProcess } from "../src/terminal/pty-backend.js";

const decoder = new TextDecoder();

interface Session {
  proc: PtyProcess;
  output: () => string;
  exited: Promise<number | null>;
}

function open(factory: () => PtyProcess): Session {
  const proc = factory();
  let text = "";
  proc.onData((data) => {
    text += decoder.decode(data);
  });
  const { promise: exited, resolve } = Promise.withResolvers<number | null>();
  proc.onExit(resolve);
  return { proc, output: () => text, exited };
}

async function waitFor(session: Session, needle: string): Promise<void> {
  const deadline = Date.now() + 5000;
  while (!session.output().includes(needle)) {
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for ${JSON.stringify(needle)}: ${session.output()}`);
    }
    await Bun.sleep(10);
  }
}

describe("module loading under Bun", () => {
  it("importing the terminal module and creating the default backend never loads node-pty", async () => {
    const loaded: string[] = [];
    Bun.plugin({
      name: "node-pty-tripwire",
      setup(build) {
        // `onResolve` is not consulted for bare package specifiers; `onLoad` sees every file.
        build.onLoad({ filter: /node-pty/ }, (args) => {
          loaded.push(args.path);
          throw new Error("node-pty must not be loaded under Bun");
        });
      },
    });

    // The tripwire is live: a deliberate import of node-pty trips it (negative control).
    await expect(import("node-pty")).rejects.toThrow();
    expect(loaded.length).toBeGreaterThan(0);
    loaded.length = 0;

    const terminal = await import("../src/terminal/index.js");
    const backend = terminal.createDefaultPtyBackend();

    expect(backend).toBeInstanceOf(BunPtyBackend);
    expect(loaded).toEqual([]);
  });
});

describe("BunPtyBackend (real TTY)", () => {
  const backend = new BunPtyBackend({
    resolveExecutable: (bin) => (bin === "sh" ? "/bin/sh" : bin),
    killTree: (_pid, _signal, then) => then?.(),
  });

  it("spawns /bin/sh on a real PTY, echoes input, resizes and reports the exit code", async () => {
    const session = open(() =>
      backend.spawn({ shell: "/bin/sh", cwd: "/tmp", env: { PI_TEST: "yes" }, cols: 80, rows: 24 }),
    );

    session.proc.write(new TextEncoder().encode("test -t 0 && echo HAS_TTY\n"));
    await waitFor(session, "HAS_TTY");

    session.proc.write(new TextEncoder().encode("echo T=$TERM P=$PWD E=$PI_TEST\n"));
    await waitFor(session, "T=xterm-256color P=/tmp E=yes");

    session.proc.write(new TextEncoder().encode("stty size\n"));
    await waitFor(session, "24 80");

    session.proc.resize(120, 40);
    session.proc.write(new TextEncoder().encode("stty size\n"));
    await waitFor(session, "40 120");

    session.proc.write(new TextEncoder().encode("exit 7\n"));
    expect(await session.exited).toBe(7);
  });

  it("delivers all output before the exit event", async () => {
    const session = open(() =>
      backend.spawn({
        shell: "/bin/sh",
        args: ["-c", "head -c 200000 /dev/zero | tr '\\0' x; exit 3"],
        cols: 80,
        rows: 24,
      }),
    );
    expect(await session.exited).toBe(3);
    expect(session.output().replace(/[\r\n]/g, "")).toHaveLength(200000);
  });

  it("kill() terminates the process and reports a signal exit code", async () => {
    const session = open(() =>
      backend.spawn({ shell: "/bin/sh", args: ["-c", "sleep 30"], cols: 80, rows: 24 }),
    );
    session.proc.kill();
    expect(await session.exited).toBe(143);
  });

  it("throws synchronously when the shell does not exist", () => {
    expect(() => backend.spawn({ shell: "/nonexistent/shell", cols: 80, rows: 24 })).toThrow();
  });

  it("ignores write and resize after the process has exited", async () => {
    const session = open(() =>
      backend.spawn({ shell: "/bin/sh", args: ["-c", "exit 0"], cols: 80, rows: 24 }),
    );
    await session.exited;
    session.proc.write(new TextEncoder().encode("late\n"));
    session.proc.resize(100, 30);
  });
});
