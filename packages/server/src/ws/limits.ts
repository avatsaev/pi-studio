/**
 * Per-connection limits of the direct WebSocket server and of relay sessions, in one place.
 * Tests shorten `HELLO_TIMEOUT_MS` through the deps of `createWebSocketServer` and
 * `attachRelaySession`, and `PING_INTERVAL_MS` through the deps of `createWebSocketServer`; the
 * others ship as written.
 */

/** How long a connection may stay open without sending a valid `hello`. Over it: close 1008. */
export const HELLO_TIMEOUT_MS = 10_000;

/**
 * How often the direct WebSocket server pings every socket. One that showed no life (a pong or any
 * frame) since the previous ping is terminated, so a vanished client is gone within two intervals.
 * Relay sockets have their own silence timer and are not pinged.
 */
export const PING_INTERVAL_MS = 30_000;

/**
 * The largest WebSocket message a direct socket accepts; a larger one closes it with 1009.
 * Real clients stay well under it: upload chunks are 32 KiB, terminal input is a few bytes, a file
 * save is at most 5 MiB (`MAX_INLINE_FILE_READ_BYTES`, up to about six times that once JSON-escaped)
 * and a prompt carries its images as base64 (a 20 MB picture is 27 MB). The relay's own limit is
 * 100 MiB and the desktop proxy's 128 MiB; both are larger on purpose, this one decides.
 */
export const MAX_FRAME_BYTES = 32 * 1024 * 1024;

/** Requests one session may have running at once; one more gets `rpc_error` `too_many_requests`. */
export const MAX_INFLIGHT_REQUESTS = 64;

/**
 * Bytes a session's socket may have queued and unsent before it is cut off: closed with 1013
 * ("send queue full") and terminated, so a client that stops reading cannot grow the daemon's
 * memory. The client reconnects and resyncs. A download paces itself at 1 MiB and never reaches it.
 */
export const MAX_SEND_QUEUE_BYTES = 16 * 1024 * 1024;
