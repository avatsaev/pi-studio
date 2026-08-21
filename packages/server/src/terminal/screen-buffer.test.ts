import { describe, expect, it } from "vitest";

import { ScreenBuffer } from "./screen-buffer.js";

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

describe("ScreenBuffer", () => {
  it("renders the visible grid as plain text", async () => {
    const sb = new ScreenBuffer(80, 24);
    sb.write(enc("hello world"));
    await sb.flush();
    expect(sb.snapshotText()).toBe("hello world");
    sb.dispose();
  });

  it("resolves carriage-return overwrites (a raw strip-ansi would keep both)", async () => {
    const sb = new ScreenBuffer(80, 24);
    // A classic progress-bar style redraw: write, return to col 0, overwrite.
    sb.write(enc("Downloading 10%\rDownloading 100%"));
    await sb.flush();
    const text = sb.snapshotText();
    expect(text).toBe("Downloading 100%");
    expect(text).not.toContain("10%");
    sb.dispose();
  });

  it("honors clear-screen (ESC[2J ESC[H) so stale content is gone", async () => {
    const sb = new ScreenBuffer(80, 24);
    sb.write(enc("old noisy output everywhere"));
    await sb.flush();
    sb.write(enc("\x1b[2J\x1b[Hfresh"));
    await sb.flush();
    const text = sb.snapshotText();
    expect(text).toBe("fresh");
    expect(text).not.toContain("noisy");
    sb.dispose();
  });

  it("strips residual ANSI color codes from captured text", async () => {
    const sb = new ScreenBuffer(80, 24);
    sb.write(enc("\x1b[31mred\x1b[0m text"));
    await sb.flush();
    expect(sb.snapshotText()).toBe("red text");
    sb.dispose();
  });

  it("serialize() preserves SGR colour attributes that snapshotText() strips", async () => {
    const sb = new ScreenBuffer(80, 24);
    sb.write(enc("\x1b[31mred\x1b[0m normal"));
    await sb.flush();
    const payload = sb.serialize();
    // The raw escape sequence survives — unlike snapshotText(), which strips it deliberately.
    expect(payload).toContain("\x1b[31m");

    // Replaying it into a fresh screen restores the identical visible text.
    const restored = new ScreenBuffer(80, 24);
    restored.write(enc(payload));
    await restored.flush();
    expect(restored.snapshotText()).toBe(sb.snapshotText());
    expect(restored.snapshotText()).toBe("red normal");
    sb.dispose();
    restored.dispose();
  });

  it("serialize() restores cursor position, not just text", async () => {
    const sb = new ScreenBuffer(80, 24);
    sb.write(enc("abc")); // cursor left mid-line, no trailing newline
    await sb.flush();
    const payload = sb.serialize();

    const restored = new ScreenBuffer(80, 24);
    restored.write(enc(payload));
    await restored.flush();
    // If the cursor landed anywhere else (e.g. column 0), this would overwrite "abc" instead of
    // appending after it.
    restored.write(enc("X"));
    await restored.flush();
    expect(restored.snapshotText()).toBe("abcX");
    sb.dispose();
    restored.dispose();
  });

  it("serialize() bounds scrollback to a predictable size regardless of history length", async () => {
    const sb = new ScreenBuffer(20, 5, 1000);
    const lines = Array.from({ length: 500 }, (_, i) => `line-${i}`);
    sb.write(enc(lines.join("\r\n") + "\r\n"));
    await sb.flush();
    const payload = sb.serialize();
    // The earliest lines are outside the bound...
    expect(payload).not.toContain("line-0\r");
    expect(payload).not.toContain("line-50\r");
    // ...but the most recent history (right above the viewport) is still included.
    expect(payload).toContain("line-490");
    // A 500-line history does not produce a 500-line payload.
    expect(payload.length).toBeLessThan(10_000);
    sb.dispose();
  });
});
