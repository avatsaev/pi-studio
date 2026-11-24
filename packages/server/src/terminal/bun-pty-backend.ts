import type { PtyBackend, PtyProcess, PtySpawnOptions } from "./pty-backend.js";

/**
 * Minimal local declaration of the slice of Bun's API this backend uses (the workspace compiles
 * against `@types/node` only; Bun's own types are deliberately not a dependency). Verified against
 * Bun 1.4.5: `Bun.spawn(cmd, { terminal })` allocates a real PTY, the child gets it as its
 * controlling terminal, and `subprocess.terminal` exposes write/resize/close (all throw once the
 * terminal is closed).
 */
interface BunTerminal {
  write(data: string | Uint8Array): number;
  resize(cols: number, rows: number): void;
  close(): void;
}

interface BunSubprocess {
  readonly pid: number;
  readonly terminal: BunTerminal | undefined;
  /** Resolves with the exit code (128 + signal number when the child was killed by a signal). */
  readonly exited: Promise<number>;
  kill(): void;
}

interface BunSpawnOptions {
  cwd?: string;
  env?: Record<string, string | undefined>;
  terminal: {
    cols: number;
    rows: number;
    data(terminal: BunTerminal, data: Uint8Array): void;
  };
}

interface BunRuntime {
  spawn(cmd: string[], options: BunSpawnOptions): BunSubprocess;
}

/** Module-local: shadows any ambient `Bun` global instead of conflicting with it. */
declare const Bun: BunRuntime | undefined;

/** True when running under Bun (the compiled `pi-studio` binary or `bun run`). */
export function isBunRuntime(): boolean {
  return typeof Bun !== "undefined";
}

/** Same value node-pty is given as `name` (and exports as `TERM`) in `NodePtyBackend`. */
const TERM_NAME = "xterm-256color";

/**
 * The two `pty-backend.ts` helpers this backend shares with the others. Injected (rather than
 * imported) so this module has no runtime dependency on `pty-backend.ts`, which imports it.
 */
export interface BunPtyBackendDeps {
  resolveExecutable(bin: string, env?: Record<string, string | undefined>): string;
  killTree(pid: number | undefined): void;
}

/** Production backend under Bun: a real PTY via `Bun.spawn(…, { terminal })`. */
export class BunPtyBackend implements PtyBackend {
  constructor(private readonly deps: BunPtyBackendDeps) {}

  spawn(opts: PtySpawnOptions): PtyProcess {
    if (typeof Bun === "undefined") throw new Error("BunPtyBackend requires the Bun runtime");

    const dataCbs: Array<(data: Uint8Array) => void> = [];
    const exitCbs: Array<(code: number | null) => void> = [];

    const shell = this.deps.resolveExecutable(opts.shell, opts.env ?? process.env);
    const cwd = opts.cwd ?? process.cwd();
    const proc = Bun.spawn([shell, ...(opts.args ?? [])], {
      cwd,
      // Same environment node-pty hands the child: the daemon's env, the caller's overrides, and
      // the terminal name / working directory node-pty always exports.
      env: { ...process.env, ...opts.env, TERM: TERM_NAME, PWD: cwd },
      terminal: {
        cols: opts.cols,
        rows: opts.rows,
        data: (_terminal, data) => {
          for (const cb of dataCbs) cb(data);
        },
      },
    });

    void proc.exited.then((code) => {
      // Bun delivers every data chunk before `exited` resolves (measured), like node-pty's onExit.
      try {
        proc.terminal?.close();
      } catch {
        // Already closed.
      }
      for (const cb of exitCbs) cb(code);
    });

    return {
      write: (data) => {
        try {
          proc.terminal?.write(data);
        } catch {
          // Input typed after the PTY exited (the terminal is closed then); drop it.
        }
      },
      resize: (cols, rows) => {
        try {
          proc.terminal?.resize(cols, rows);
        } catch {
          // PTY may have exited between the size change and this call; ignore.
        }
      },
      kill: () => {
        this.deps.killTree(proc.pid);
        try {
          proc.kill();
        } catch {
          // Already exited.
        }
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
