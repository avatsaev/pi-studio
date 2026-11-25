import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";

import treeKill from "tree-kill";
import which from "which";

import { BunPtyBackend, isBunRuntime } from "./bun-pty-backend.js";

/**
 * PTY backend abstraction (features/terminals.md § Behavior). The production backend is `node-pty`,
 * which gives a **real TTY** (programs see `isatty`, get SIGWINCH on resize, and run full-screen
 * apps like vim/htop correctly). Under Bun, `node-pty` does not work (the shell dies with SIGHUP),
 * so `BunPtyBackend` (`Bun.spawn(…, { terminal })`) is used instead. A piped-`child_process` fallback
 * remains for environments where the native module is unavailable and for deterministic tests
 * (which inject their own fake backend).
 */

export interface PtyProcess {
  write(data: Uint8Array): void;
  resize(cols: number, rows: number): void;
  /** Ask the process (and its descendants) to stop: SIGTERM, or SIGKILL when `force` is set. */
  kill(force?: boolean): void;
  onData(cb: (data: Uint8Array) => void): void;
  onExit(cb: (code: number | null) => void): void;
}

export interface PtySpawnOptions {
  shell: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  cols: number;
  rows: number;
}

export interface PtyBackend {
  spawn(opts: PtySpawnOptions): PtyProcess;
}

const encoder = new TextEncoder();

/**
 * `node-pty`, or `undefined` under Bun / when its native binding cannot be loaded. The import is
 * dynamic and conditional because it must never load under Bun: there the shell dies at once with
 * SIGHUP and loading it stops the compiled daemon from starting.
 */
const nodePty = isBunRuntime()
  ? undefined
  : await import("node-pty").then(
      (module) => module.default,
      () => undefined,
    );

/**
 * Resolve a shell/binary name to an absolute path via `$PATH` (cross-platform, honors Windows
 * PATHEXT). Returns the input unchanged when it already looks like a path or cannot be resolved
 * (the spawn will then surface a clear ENOENT).
 */
export function resolveExecutable(
  bin: string,
  env: Record<string, string | undefined> = process.env,
): string {
  if (bin.includes("/") || bin.includes("\\")) return bin;
  const resolved = which.sync(bin, { nothrow: true, path: env.PATH ?? env.Path });
  return resolved ?? bin;
}

/** Best-effort termination of a whole process tree (kills orphaned grandchildren too). */
export function killTree(pid: number | undefined, signal: NodeJS.Signals = "SIGTERM"): void {
  if (pid === undefined) return;
  treeKill(pid, signal, () => {
    // Best-effort: ignore errors (process may already be gone).
  });
}

/** Production backend under Node: a real PTY via `node-pty`. */
export class NodePtyBackend implements PtyBackend {
  spawn(opts: PtySpawnOptions): PtyProcess {
    if (nodePty === undefined) throw new Error("node-pty is not available in this runtime");
    const shell = resolveExecutable(opts.shell, opts.env ?? process.env);
    const proc = nodePty.spawn(shell, opts.args ?? [], {
      name: "xterm-256color",
      cols: opts.cols,
      rows: opts.rows,
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env } as Record<string, string>,
    });

    return {
      write: (data) => proc.write(Buffer.from(data).toString("utf8")),
      resize: (cols, rows) => {
        try {
          proc.resize(cols, rows);
        } catch {
          // PTY may have exited between the size change and this call; ignore.
        }
      },
      kill: (force) => {
        killTree(proc.pid, force ? "SIGKILL" : "SIGTERM");
        try {
          // node-pty's own default signal is SIGHUP, which also ends an interactive shell.
          proc.kill(force ? "SIGKILL" : undefined);
        } catch {
          // Already exited.
        }
      },
      onData: (cb) => {
        proc.onData((s) => cb(encoder.encode(s)));
      },
      onExit: (cb) => {
        proc.onExit(({ exitCode }) => cb(exitCode));
      },
    };
  }
}

/** Fallback backend: a piped child process. Not a real TTY, but streams stdout/stderr ⇄ stdin. */
export class ChildProcessPtyBackend implements PtyBackend {
  spawn(opts: PtySpawnOptions): PtyProcess {
    const child: ChildProcessWithoutNullStreams = spawn(
      resolveExecutable(opts.shell, opts.env ?? process.env),
      opts.args ?? [],
      {
        cwd: opts.cwd,
        env: { ...process.env, ...opts.env },
        windowsHide: true,
      },
    ) as ChildProcessWithoutNullStreams;

    const dataCbs: Array<(data: Uint8Array) => void> = [];
    const exitCbs: Array<(code: number | null) => void> = [];

    const emit = (chunk: Buffer): void => {
      const bytes = new Uint8Array(chunk);
      for (const cb of dataCbs) cb(bytes);
    };
    child.stdout?.on("data", emit);
    child.stderr?.on("data", emit);
    child.on("exit", (code) => {
      for (const cb of exitCbs) cb(code);
    });

    return {
      write: (data) => {
        child.stdin?.write(Buffer.from(data));
      },
      resize: () => {
        // No-op for piped child processes (no TTY); the node-pty backend calls `pty.resize`.
      },
      kill: (force) => {
        const signal = force ? "SIGKILL" : "SIGTERM";
        killTree(child.pid, signal);
        child.kill(signal);
      },
      onData: (cb) => {
        dataCbs.push(cb);
      },
      onExit: (cb) => {
        exitCbs.push(cb);
      },
    };
  }
}

/**
 * Default backend factory: under Bun the Bun PTY; under Node the real PTY (`node-pty`), and if the
 * native module cannot be loaded on this platform, the piped child-process backend.
 */
export function createDefaultPtyBackend(): PtyBackend {
  if (isBunRuntime()) return new BunPtyBackend({ resolveExecutable, killTree });
  return nodePty === undefined ? new ChildProcessPtyBackend() : new NodePtyBackend();
}
