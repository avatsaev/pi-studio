// The bridge candidates, page side: one transport implementation behind the interface of
// `transport.js`, with the two inbound and the two outbound variants as options.
//
//   inbound  "frame": one channel message per WebSocket message (raw bytes for binary, a JSON string
//                     for text)
//            "batch": batches in the codec's format (`batch.js`)
//   outbound "frame": one invoke per frame (`bridge_send_text`, `bridge_send_binary`, with `seq`)
//            "batch": the frames queued in the same task go out as one raw invoke
//                     (`bridge_send_batch`, one `seq` per invoke)
//
// The page acknowledges what `onMessage` has returned from, every 256 KiB or 50 ms (`bridge_ack`).
// `bufferedAmount` is what the spec defines: a frame's byte length is added when it is sent and
// subtracted when the answer of its send arrives (the answer means: written to the socket).
// `ack: false` is the test mode in which the page never acknowledges, to show that Rust stops
// reading at the window; `enableAck()` ends it.

import { KIND_BINARY, KIND_TEXT, decodeText, encodeBatch, forEachItem, utf8Length } from "./batch.js";

/** Acknowledge when this many bytes were delivered since the last acknowledgement... */
export const ACK_BYTES = 256 * 1024;
/** ...or this many milliseconds after the first byte that has not been acknowledged. */
export const ACK_MS = 50;
/** A batch of outbound frames is sent at once when this many bytes are queued. */
export const OUTBOUND_BATCH_BYTES = 4 * 1024 * 1024;

const messageOf = (error) => (error && error.message ? error.message : typeof error === "string" ? error : JSON.stringify(error));

/**
 * @param {{ inbound: "frame" | "batch", outbound: "frame" | "batch", ack?: boolean }} options
 * @param {{ invoke: Function, Channel: Function }} tauri `window.__TAURI__.core`, or a stand-in in tests
 */
export function createBridgeTransport({ inbound, outbound, ack = true }, tauri = window.__TAURI__.core) {
  const { invoke, Channel } = tauri;
  let handle = null;
  let open = false;
  let closedSeen = false;
  let nextSeq = 0;
  let buffered = 0;
  let acking = ack;
  let unacked = 0;
  let ackTimer = null;
  let queue = [];
  let queuedBytes = 0;
  let flushScheduled = false;
  const page = { channelMessages: 0, framesDelivered: 0, bytesDelivered: 0, acksSent: 0, ackedBytes: 0, sendsInvoked: 0, maxBufferedAmount: 0 };

  const transport = {
    bridge: true,
    onMessage: null,
    onClose: null,
    onError: null,
    get isOpen() {
      return open;
    },
    get bufferedAmount() {
      return buffered;
    },
    /** What the page has delivered to `onMessage` so far, in payload bytes. */
    get bytesDelivered() {
      return page.bytesDelivered;
    },

    async connect(url) {
      const channel = new Channel();
      channel.onmessage = onChannelMessage;
      try {
        const answer = await invoke("bridge_open", { url, inbound, onMessage: channel });
        handle = answer.handle;
      } catch (error) {
        throw new Error(messageOf(error));
      }
      open = true;
    },

    sendText(data) {
      if (!guardOpen()) return;
      const bytes = utf8Length(data);
      if (outbound === "batch") return enqueue(KIND_TEXT, data, bytes);
      const seq = nextSeq++;
      track(bytes, invoke("bridge_send_text", { handle, seq, data }));
    },

    sendBinary(data) {
      if (!guardOpen()) return;
      if (outbound === "batch") return enqueue(KIND_BINARY, data, data.byteLength);
      const seq = nextSeq++;
      track(data.byteLength, invoke("bridge_send_binary", data, { headers: { handle, seq: String(seq) } }));
    },

    close(code = 1000, reason = "") {
      if (!open) return;
      open = false;
      stopAckTimer();
      invoke("bridge_close", { handle, code, reason }).catch(() => {});
    },

    /** The test mode ends: acknowledge from now on, and acknowledge what is owed now. */
    enableAck() {
      acking = true;
      return sendAck();
    },

    /** Rust's counters of this connection now, and the page's own. */
    async stats() {
      const rust = await invoke("bridge_stats", { handle });
      return { ...rust, page: { ...page, inbound, outbound, ack: acking } };
    },

    /** The record of a run: `stats()`, and the IPC path the outbound bodies took. */
    async report() {
      const stats = await transport.stats();
      return { ...stats, ipcPath: ipcPathOf(stats) };
    },
  };

  function guardOpen() {
    if (open) return true;
    fail(new Error("the connection is not open"));
    return false;
  }

  function fail(error) {
    if (transport.onError) transport.onError(error instanceof Error ? error : new Error(messageOf(error)));
  }

  // ---------------------------------------------------------------------------- outbound

  /** `bytes` count in `bufferedAmount` until the answer of the send (written to the socket) arrives. */
  function track(bytes, answer) {
    page.sendsInvoked++;
    buffered += bytes;
    if (buffered > page.maxBufferedAmount) page.maxBufferedAmount = buffered;
    answer.then(
      () => {
        buffered -= bytes;
      },
      (error) => {
        buffered -= bytes;
        fail(new Error(messageOf(error)));
      },
    );
  }

  function enqueue(kind, data, bytes) {
    queue.push({ kind, data });
    queuedBytes += bytes;
    buffered += bytes;
    if (buffered > page.maxBufferedAmount) page.maxBufferedAmount = buffered;
    if (queuedBytes >= OUTBOUND_BATCH_BYTES) flushQueue();
    else if (!flushScheduled) {
      // The frames of this task go together: the microtask runs when the task's own code is done.
      flushScheduled = true;
      queueMicrotask(flushQueue);
    }
  }

  function flushQueue() {
    flushScheduled = false;
    if (queue.length === 0) return;
    const items = queue;
    const bytes = queuedBytes;
    queue = [];
    queuedBytes = 0;
    let body;
    try {
      body = encodeBatch(items);
    } catch (error) {
      buffered -= bytes;
      fail(error);
      return;
    }
    const seq = nextSeq++;
    page.sendsInvoked++;
    // `buffered` already holds `bytes`: only the answer subtracts them.
    invoke("bridge_send_batch", body, { headers: { handle, seq: String(seq) } }).then(
      () => {
        buffered -= bytes;
      },
      (error) => {
        buffered -= bytes;
        fail(new Error(messageOf(error)));
      },
    );
  }

  // ---------------------------------------------------------------------------- inbound

  /** One WebSocket message goes to `onMessage`, then its payload counts toward the next acknowledgement. */
  function deliver(message, bytes) {
    page.framesDelivered++;
    try {
      if (transport.onMessage) transport.onMessage(message);
    } finally {
      page.bytesDelivered += bytes;
      unacked += bytes;
      if (acking) scheduleAck();
    }
  }

  function onChannelMessage(message) {
    page.channelMessages++;
    if (message instanceof ArrayBuffer) {
      if (inbound === "batch") deliverBatch(message);
      else deliver(message, message.byteLength);
    } else if (typeof message === "string") {
      deliver(message, utf8Length(message));
    } else if (message && message.closed) {
      closedMessage(message.closed);
    } else {
      fail(new Error(`an unexpected channel message: ${Object.prototype.toString.call(message)}`));
    }
  }

  function deliverBatch(buffer) {
    try {
      forEachItem(buffer, (kind, start, end) => {
        if (kind === KIND_TEXT) deliver(decodeText(buffer, start, end), end - start);
        else deliver(buffer.slice(start, end), end - start);
      });
    } catch (error) {
      // A batch the page cannot read is a bug of the bridge: say so, whatever `onMessage` threw too.
      fail(error);
    }
  }

  function closedMessage({ code, reason, error }) {
    open = false;
    stopAckTimer();
    if (closedSeen) return;
    closedSeen = true;
    if (error) {
      fail(new Error(`${error.code}: ${error.message}`));
      if (transport.onClose) transport.onClose(1006, "");
    } else if (transport.onClose) transport.onClose(code, reason);
  }

  // ---------------------------------------------------------------------------- acknowledgements

  function scheduleAck() {
    if (unacked >= ACK_BYTES) sendAck();
    else if (ackTimer === null && unacked > 0) ackTimer = setTimeout(sendAck, ACK_MS);
  }

  function stopAckTimer() {
    clearTimeout(ackTimer);
    ackTimer = null;
  }

  function sendAck() {
    stopAckTimer();
    if (!open || unacked === 0) return Promise.resolve();
    const bytes = unacked;
    unacked = 0;
    page.acksSent++;
    page.ackedBytes += bytes;
    return invoke("bridge_ack", { handle, bytes }).catch((error) => fail(new Error(messageOf(error))));
  }

  return transport;
}

/** Which way the outbound raw bodies reached Rust: as bytes (the custom protocol) or as a JSON array (`postMessage`). */
export function ipcPathOf(stats) {
  if (stats.jsonArrayBodies > 0 && stats.rawBodies > 0) return "mixed";
  if (stats.jsonArrayBodies > 0) return "postMessage (JSON array)";
  if (stats.rawBodies > 0) return "custom protocol (raw bytes)";
  return "no raw body sent";
}
