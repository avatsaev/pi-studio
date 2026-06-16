import { createRequire } from "node:module";

import stripAnsi from "strip-ansi";

// `@xterm/headless` ships a UMD bundle whose `module.exports` Node's ESM loader cannot statically
// read, so a named `import { Terminal }` resolves at type-check time but throws at runtime. Load it
// through `createRequire` (CJS) to get the real `Terminal` constructor.
const require = createRequire(import.meta.url);
const { Terminal } = require("@xterm/headless") as typeof import("@xterm/headless");
type TerminalInstance = InstanceType<typeof Terminal>;

/**
 * Server-side terminal screen model backed by `@xterm/headless` (features/terminals.md § capture).
 *
 * The binary Snapshot frame sent to subscribing clients is the raw byte ring (each client's own
 * xterm replays it faithfully). But CLI/MCP `capture()` needs the *visible grid as text* — replaying
 * raw bytes through `strip-ansi` is wrong for anything that moves the cursor, clears the screen, or
 * redraws (progress bars, full-screen apps). Feeding the byte stream through a headless terminal and
 * reading the grid yields the true on-screen text.
 */
export class ScreenBuffer {
  private readonly term: TerminalInstance;

  constructor(cols: number, rows: number, scrollback = 1000) {
    this.term = new Terminal({ cols, rows, scrollback, allowProposedApi: true });
  }

  write(data: Uint8Array): void {
    this.term.write(Buffer.from(data));
  }

  resize(cols: number, rows: number): void {
    try {
      this.term.resize(cols, rows);
    } catch {
      // Ignore invalid dimensions (e.g. 0); the live PTY resize already guards this.
    }
  }

  /** Resolve once the parser has drained all pending writes (used by tests / before capture). */
  flush(): Promise<void> {
    return new Promise((resolve) => this.term.write("", () => resolve()));
  }

  /** The visible viewport as plain text, with trailing blank lines trimmed. */
  snapshotText(): string {
    const buf = this.term.buffer.active;
    const top = buf.baseY;
    const lines: string[] = [];
    for (let y = top; y < top + this.term.rows; y++) {
      const line = buf.getLine(y);
      lines.push(line ? line.translateToString(true) : "");
    }
    while (lines.length > 0 && lines[lines.length - 1]!.trim() === "") lines.pop();
    // translateToString already yields plain text; strip-ansi defends against any passthrough.
    return stripAnsi(lines.join("\n"));
  }

  dispose(): void {
    this.term.dispose();
  }
}
