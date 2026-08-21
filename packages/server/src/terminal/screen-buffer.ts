import { createRequire } from "node:module";

import stripAnsi from "strip-ansi";
import type { ITerminalAddon, Terminal as XtermHeadlessTerminal } from "@xterm/headless";
import type { SerializeAddon as XtermSerializeAddon } from "@xterm/addon-serialize";

// `@xterm/headless` ships a UMD bundle whose `module.exports` Node's ESM loader cannot statically
// read, so a named `import { Terminal }` resolves at type-check time but throws at runtime. Load it
// through `createRequire` (CJS) to get the real `Terminal` constructor. `@xterm/addon-serialize`
// ships the same way (also a UMD bundle, no `exports` map in its `package.json`) and needs the
// identical treatment (sprint-053/task-004) — expected, not a surprise discovered at runtime. Both
// `import type`s above are erased at compile time (no runtime `import`, so no UMD-load failure);
// they only give the two `require(...)` results below a real type instead of `any`.
const require = createRequire(import.meta.url);
const { Terminal }: { Terminal: typeof XtermHeadlessTerminal } = require("@xterm/headless");
const {
  SerializeAddon,
}: { SerializeAddon: typeof XtermSerializeAddon } = require("@xterm/addon-serialize");
type TerminalInstance = InstanceType<typeof Terminal>;
type SerializeAddonInstance = InstanceType<typeof SerializeAddon>;

/**
 * Lines of scrollback history a reflowable `Restore` payload includes, on top of the viewport
 * itself (`terminals.md` § Restore / snapshot, tier 2; `feature-panels-ui.md` § Reconnect/restore:
 * "a visible-snapshot restore (bounded scrollback)"). A redraw needs the current screen, not the
 * terminal's whole retained history (`ScreenBuffer`'s own `scrollback` constructor default is
 * 1000 lines) replayed on every reattach — bounding this is what keeps the payload size
 * predictable regardless of how long the terminal has been running.
 */
const RESTORE_SCROLLBACK_LINES = 200;

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
  private readonly serializeAddon: SerializeAddonInstance;

  constructor(cols: number, rows: number, scrollback = 1000) {
    this.term = new Terminal({ cols, rows, scrollback, allowProposedApi: true });
    this.serializeAddon = new SerializeAddon();
    // `@xterm/addon-serialize`'s published types declare `activate(terminal: Terminal)` against
    // `@xterm/xterm` (the browser package) specifically, so it is not structurally assignable to
    // headless's own `ITerminalAddon` (which wants its OWN `Terminal` type) — even though the
    // addon's real implementation only reads `buffer`/`cols`/`rows`, fields both `Terminal` types
    // share, and works correctly headless (verified empirically: colours, cursor position, and
    // text all round-trip — see `serialize()` below and its tests).
    this.term.loadAddon(this.serializeAddon as unknown as ITerminalAddon);
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

  /**
   * A reflowable redraw of the current screen — SGR colours/attributes and cursor position, not
   * just text (`terminals.md` § Restore / snapshot, tier 2: the daemon's raw byte ring is
   * approximate at a different width; this is the payload sent instead when both ends support
   * it). Computed on demand, not maintained continuously, so an idle terminal costs nothing extra
   * beyond what `capture`/`snapshotText` already require. Bounded to
   * `RESTORE_SCROLLBACK_LINES` — verified empirically against `@xterm/addon-serialize@0.14.0`
   * paired with `@xterm/headless@6.0.0` (no published peer range covers this pairing yet; the
   * addon's actual API — reading `buffer.active` cells/modes — has been runtime-compatible across
   * this xterm major since it predates the `@xterm/*` scoped rename).
   */
  serialize(): string {
    return this.serializeAddon.serialize({ scrollback: RESTORE_SCROLLBACK_LINES });
  }

  dispose(): void {
    this.term.dispose();
  }
}
