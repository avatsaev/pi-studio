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
import { watchChannel, watchPage } from "./watch.js";

/** Acknowledge when this many bytes were delivered since the last acknowledgement... */
export const ACK_BYTES = 256 * 1024;
/** ...or this many milliseconds after the first byte that has not been acknowledged. */
export const ACK_MS = 50;
/** A batch of outbound frames is sent at once when this many bytes are queued. */
export const OUTBOUND_BATCH_BYTES = 4 * 1024 * 1024;
/** How long a send that found its connection gone waits for the `closed` message before it reports itself. */
export const CLOSED_GRACE_MS = 250;
/** Rust's default bound on unacknowledged channel messages, for an `open` answer that does not name one. */
export const DEFAULT_MAX_MESSAGES = 512;

const messageOf = (error) => (error && error.message ? error.message : typeof error === "string" ? error : JSON.stringify(error));
/** What Rust answers for a handle it does not have (the spec's `unknown_handle`). */
const isUnknownHandle = (error) => Boolean(error) && error.code === "unknown_handle";

/**
 * @param {{ inbound: "frame" | "batch", outbound: "frame" | "batch", ack?: boolean }} options
 * @param {{ invoke: Function, Channel: Function }} tauri `window.__TAURI__.core`, or a stand-in in tests
 */
export function createBridgeTransport({ inbound, outbound, ack = true }, tauri = window.__TAURI__.core, env = typeof window === "undefined" ? {} : window) {
  const { invoke, Channel } = tauri;
  const pageWatch = watchPage(env);
  let channelWatch = null;
  let handle = null;
  let open = false;
  let closedSeen = false;
  let nextSeq = 0;
  let buffered = 0;
  let acking = ack;
  let unacked = 0;
  let messagesUnacked = 0;
  let ackMessages = Math.floor(DEFAULT_MAX_MESSAGES / 4);
  let ackTimer = null;
  let queue = [];
  let queuedBytes = 0;
  let flushScheduled = false;
  const page = {
    channelMessages: 0,
    messagesDelivered: 0,
    framesDelivered: 0,
    bytesDelivered: 0,
    acksSent: 0,
    ackedBytes: 0,
    ackedMessages: 0,
    sendsInvoked: 0,
    maxBufferedAmount: 0,
  };

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
      // Look at the callbacks Tauri's channel gets before it puts them in order (it exposes the map for debugging).
      channelWatch = watchChannel(env.__TAURI_INTERNALS__ && env.__TAURI_INTERNALS__.callbacks, channel.id);
      try {
        const answer = await invoke("bridge_open", { url, inbound, onMessage: channel });
        handle = answer.handle;
        // Acknowledge well before Rust's bound is reached: a quarter of it, so that Rust resumes (below half) in time.
        ackMessages = Math.max(1, Math.floor((answer.maxMessages ?? DEFAULT_MAX_MESSAGES) / 4));
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
      const seen = pageWatch ? pageWatch.summary() : null;
      return {
        ...rust,
        page: { ...page, inbound, outbound, ack: acking, channel: channelWatch ? channelWatch.summary() : null, fetches: seen, console: seen ? seen.console : null },
      };
    },

    /** For a run that stalled: where the connection stands, in one line. */
    async describe() {
      try {
        return describeStats(await transport.stats());
      } catch (error) {
        return `the connection's counters are not available: ${messageOf(error)}`;
      }
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

  /**
   * A send was refused. A send on a connection Rust no longer has is still an error (the frame did not go),
   * but when Rust forgot the connection because its socket ended, the `closed` message that says why is on its
   * way: give it a moment, so that the error the transport reports is the cause and not the symptom.
   */
  function sendFailed(error) {
    const failure = new Error(messageOf(error));
    if (!isUnknownHandle(error) || closedSeen) fail(failure);
    else {
      setTimeout(() => {
        if (!closedSeen) fail(failure);
      }, CLOSED_GRACE_MS);
    }
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
        sendFailed(error);
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
        sendFailed(error);
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
    }
  }

  /**
   * One channel message: the frames it holds go to `onMessage`, and then it counts, with its bytes, toward the
   * next acknowledgement. Rust bounds the messages it has sent and not had acknowledged next to the bytes: a
   * webview takes each as a script to evaluate, and a flood of small ones queues too many.
   */
  function onChannelMessage(message) {
    page.channelMessages++;
    if (message instanceof ArrayBuffer || typeof message === "string") {
      try {
        if (typeof message === "string") deliver(message, utf8Length(message));
        else if (inbound === "batch") deliverBatch(message);
        else deliver(message, message.byteLength);
      } finally {
        page.messagesDelivered++;
        messagesUnacked++;
        if (acking) scheduleAck();
      }
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
    if (unacked >= ACK_BYTES || messagesUnacked >= ackMessages) sendAck();
    else if (ackTimer === null && (unacked > 0 || messagesUnacked > 0)) ackTimer = setTimeout(sendAck, ACK_MS);
  }

  function stopAckTimer() {
    clearTimeout(ackTimer);
    ackTimer = null;
  }

  function sendAck() {
    stopAckTimer();
    if (!open || (unacked === 0 && messagesUnacked === 0)) return Promise.resolve();
    const bytes = unacked;
    const messages = messagesUnacked;
    unacked = 0;
    messagesUnacked = 0;
    page.acksSent++;
    page.ackedBytes += bytes;
    page.ackedMessages += messages;
    // An acknowledgement that finds its connection gone (the socket ended while the page was still working
    // through what Rust had sent) is harmless: the `closed` message says what happened. Anything else is an error.
    return invoke("bridge_ack", { handle, bytes, messages }).catch((error) => {
      if (!isUnknownHandle(error)) fail(new Error(messageOf(error)));
    });
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

/**
 * What the counters say went wrong, from the evidence alone: a gap in Tauri's channel indexes (a message that was
 * lost on its way to the page, with later ones waiting behind it), a tail that never arrived, or acknowledgements
 * that never reached Rust. Empty when nothing points at one.
 */
export function diagnose(stats) {
  const page = stats.page || {};
  const channel = page.channel;
  if (channel && channel.waiting > 0 && channel.missingIndexes.length > 0) {
    return `Tauri's channel lost message ${channel.missingIndexes[0]}: it never reached the page, and ${channel.waiting} later messages wait behind it`;
  }
  if (channel && channel.waiting === 0 && stats.channelMessages > channel.highestIndex + 1) {
    return `${stats.channelMessages - (channel.highestIndex + 1)} of the messages Rust sent never reached the page (the channel's last index seen is ${channel.highestIndex}, Rust sent ${stats.channelMessages})`;
  }
  const rustAcked = stats.channelMessages - stats.messagesOutstanding;
  if (typeof page.ackedMessages === "number" && page.ackedMessages > rustAcked) {
    return `acknowledgements the page sent never reached Rust (the page acknowledged ${page.ackedMessages} messages, Rust has ${rustAcked})`;
  }
  return "";
}

/**
 * One line that says where a connection stands, for the error of a run that stalled: what Rust sent, what the
 * page took, what is unacknowledged against the two bounds, whether and why the connection ended, what Tauri's
 * channel looked like from the page (raw callbacks before the reordering, the next index it waits for, the gap),
 * the page's fetches of channel data, and what the evidence points to.
 */
export function describeStats(stats) {
  const page = stats.page || {};
  const end = stats.ended
    ? `ended ${stats.ended.byPage ? "by the page" : "by itself"}: code ${stats.ended.code}${stats.ended.reason ? ` (${stats.ended.reason})` : ""}${
        stats.ended.error ? `, ${stats.ended.error.code}: ${stats.ended.error.message}` : ""
      }`
    : "the connection is still open";
  const channel = page.channel;
  const fetches = page.fetches && page.fetches.channelFetches;
  const consoleLines = page.console && page.console.recent && page.console.recent.length > 0 ? `; console: ${page.console.recent.join(" | ")}` : "";
  const parts = [
    `Rust sent ${stats.framesIn} frames (${stats.bytesIn} bytes) in ${stats.channelMessages} channel messages (${stats.channelSendErrors ?? "?"} Channel::send errors), the page delivered ${page.framesDelivered ?? "?"} frames ` +
      `in ${page.messagesDelivered ?? page.channelMessages ?? "?"} messages and acknowledged ${page.ackedMessages ?? "?"} messages in ${page.acksSent ?? "?"} acks; ${stats.outstanding} bytes and ${stats.messagesOutstanding} messages unacknowledged ` +
      `(peak ${stats.maxOutstanding} bytes of ${stats.windowHighBytes}, ${stats.maxMessagesInFlight} messages of ${stats.windowMaxMessages}); ` +
      `reading is ${stats.mayRead ? "allowed" : "stopped"}; ${end}`,
    channel
      ? `Tauri's channel in the page got ${channel.rawCallbacks} raw callbacks (the last ${channel.idleMs} ms ago), waits for index ${channel.nextIndex}, highest index seen ${channel.highestIndex}, ` +
        `${channel.waiting} waiting behind ${channel.missingIndexes.length > 0 ? `a gap at ${channel.missingIndexes.join(", ")}` : "no gap"}, ${channel.duplicates} duplicates, ${channel.ends} end markers`
      : "the channel's raw callbacks could not be observed",
    fetches
      ? `fetches of channel data: ${fetches.started} started, ${fetches.ok} ok, ${fetches.errorResponses} answered with an error, ${fetches.rejected} rejected, ${fetches.pending} pending${
          fetches.lastFailure ? ` (last failure: ${fetches.lastFailure})` : ""
        }`
      : "fetches of channel data are not observed",
  ];
  const diagnosis = diagnose(stats);
  return `${parts.join("; ")}${consoleLines}${diagnosis ? `; DIAGNOSIS: ${diagnosis}` : ""}`;
}
