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
});
