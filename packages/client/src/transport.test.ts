import { describe, expect, it } from "vitest";

import { createWebSocketTransport, type AnyWebSocket } from "./transport.js";

/** Minimal `AnyWebSocket` double that records what `connect()` does to it. */
function makeFakeSocket(): AnyWebSocket {
  return {
    readyState: 1, // OPEN
    send: () => {},
    close: () => {},
    onopen: null,
    onclose: null,
    onerror: null,
    onmessage: null,
    binaryType: undefined,
  };
}

describe("createWebSocketTransport", () => {
  it('forces binaryType to "arraybuffer" on the underlying socket', async () => {
    // Regression test: this is what makes `DaemonClient.handleIncoming` receive every binary
    // WS message synchronously as an ArrayBuffer instead of an async-decoded Blob. Without it,
    // independent `Blob.arrayBuffer()` decodes race and can resolve out of wire order — for a
    // multi-frame file-transfer download, that let an `End` frame's decode finish before a
    // straggling `Chunk`'s, and `FileTransferClient.dispatch()` silently drops any `Chunk` that
    // arrives after `End` already deleted the stream's pending state (real bug: downloaded
    // images truncated mid-file, bottom rows missing). Browsers/RN default `binaryType` to
    // `"blob"`; this assertion is the one thing standing between "always arraybuffer" and that
    // regressing back in by a future edit that drops the assignment.
    let created: AnyWebSocket | null = null;
    const transport = createWebSocketTransport(() => {
      created = makeFakeSocket();
      return created;
    });

    const connectPromise = transport.connect("ws://example.test/");
    created?.onopen?.(undefined);
    await connectPromise;

    expect(created?.binaryType).toBe("arraybuffer");
  });
});
