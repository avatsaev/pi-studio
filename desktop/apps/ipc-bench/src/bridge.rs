//! The bridge candidates' Rust side: a client socket to the benchmark's own server, with the page
//! on the other end of a Tauri `Channel` (inbound) and of commands (outbound). The commands are the
//! benchmark's own, shaped like the spec's (`swe/features/desktop-transport-bridge.md` § 2–3):
//!
//! | Command | Meaning |
//! |---|---|
//! | `bridge_open` | dial the server, start a read task and a write task, answer `{ handle }` |
//! | `bridge_send_text`, `bridge_send_binary` | one outbound frame, with its `seq`; answered once written |
//! | `bridge_send_batch` | outbound variant (b): several frames in the codec's format under one `seq` |
//! | `bridge_ack` | the page has finished with `bytes` of inbound payload |
//! | `bridge_close`, `bridge_stats` | close, and the counters of one connection |
//!
//! **Inbound** has two variants, chosen per connection: [`Inbound::Frame`] sends one channel message
//! per WebSocket message (raw for binary, JSON for text); [`Inbound::Batch`] sends batches in the
//! `net` codec's format, flushed when 64 KiB is waiting or the socket has nothing more to give right
//! now. Either way the `net` crate's [`InboundWindow`] counts the payload bytes sent and not yet
//! acknowledged, and the read task stops reading while it says so.
//!
//! **Outbound** frames pass through the `net` crate's [`OrderBuffer`]: a frame whose `seq` is not the
//! next waits for the ones before it. The write task writes in order, flushing once per group of
//! queued frames, and answers each command after the flush.
//!
//! What a run records: whether raw bodies reached Rust as bytes or as a JSON array (Tauri's
//! `postMessage` fallback), how many sends arrived out of `seq` order, and the window's numbers.
//!
//! The socket is plain and local: this is a measuring instrument, not the shipped bridge.

use std::collections::HashMap;
use std::hash::BuildHasher as _;
use std::sync::atomic::{AtomicU64, Ordering::Relaxed};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::{Duration, Instant};

use futures_util::stream::{SplitSink, SplitStream};
use futures_util::{FutureExt as _, SinkExt as _, StreamExt as _};
use pistudiodesktop_net::limits::{MAX_MESSAGE_BYTES, WINDOW_HIGH_BYTES};
use pistudiodesktop_net::{InboundWindow, Item, OrderBuffer, decode, encode_binary, encode_text};
use serde::Serialize;
use tauri::ipc::{Channel, InvokeBody, InvokeResponseBody};
use tokio::net::TcpStream;
use tokio::sync::{Notify, mpsc, oneshot};
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::tungstenite::protocol::frame::coding::CloseCode;
use tokio_tungstenite::tungstenite::protocol::{CloseFrame, WebSocketConfig};
use tokio_tungstenite::{WebSocketStream, client_async_with_config};

use crate::server::Fed;

/// A batch is sent when this many bytes are waiting.
const BATCH_FLUSH_BYTES: usize = 64 * 1024;
/// The write task flushes after this many bytes of queued frames, even when more are queued.
const WRITE_FLUSH_BYTES: usize = 1024 * 1024;
/// The spec's limit of bridged sockets.
const MAX_SOCKETS: usize = 4;
const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
/// Tauri 2.12.5 (`ipc/channel.rs`) evaluates a raw channel message under this many bytes into the page...
const TAURI_DIRECT_RAW_BYTES: usize = 1024;
/// ...and a JSON one under this many; a larger one is fetched by the page.
const TAURI_DIRECT_JSON_BYTES: usize = 8192;

type Ws = WebSocketStream<TcpStream>;
type Sink = SplitSink<Ws, Message>;
type Done = oneshot::Sender<Result<(), BridgeError>>;
type Registry = Arc<Mutex<HashMap<String, Arc<Conn>>>>;

/// An error the page sees: a code to match on and a message to read.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct BridgeError {
    pub code: &'static str,
    pub message: String,
}

fn err(code: &'static str, message: impl Into<String>) -> BridgeError {
    BridgeError { code, message: message.into() }
}

fn closed_error() -> BridgeError {
    err("closed", "the connection is closed")
}

/// A poisoned lock still holds consistent data here (counters and queues): keep going.
fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

/// How inbound frames reach the page.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Inbound {
    /// One channel message per WebSocket message.
    Frame,
    /// Batches in the codec's format.
    Batch,
}

impl Inbound {
    pub fn parse(text: &str) -> Result<Self, BridgeError> {
        match text {
            "frame" => Ok(Inbound::Frame),
            "batch" => Ok(Inbound::Batch),
            other => Err(err("invalid_mode", format!("inbound is `frame` or `batch`, not {other:?}"))),
        }
    }
}

/// What a connection counted. All atomics: the tasks and the commands share them.
#[derive(Default)]
struct Counters {
    frames_in: AtomicU64,
    bytes_in: AtomicU64,
    channel_messages: AtomicU64,
    direct_messages: AtomicU64,
    fetched_messages: AtomicU64,
    frames_out: AtomicU64,
    bytes_out: AtomicU64,
    raw_bodies: AtomicU64,
    json_array_bodies: AtomicU64,
    out_of_order: AtomicU64,
    max_waiting: AtomicU64,
    max_outstanding: AtomicU64,
    pauses: AtomicU64,
    acks: AtomicU64,
    acked_bytes: AtomicU64,
}

/// The counters of one connection, as the page reads them.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Stats {
    /// WebSocket messages received from the server and forwarded to the page.
    pub frames_in: u64,
    /// Their payload bytes (what the window counts).
    pub bytes_in: u64,
    /// Messages sent on the channel: equals `frames_in` per frame, fewer with batches.
    pub channel_messages: u64,
    /// Of those, the ones Tauri evaluates into the page (a raw message under 1,024 bytes, a JSON one under
    /// 8,192): the others make the page fetch the body, one more round trip each.
    pub direct_messages: u64,
    pub fetched_messages: u64,
    pub frames_out: u64,
    pub bytes_out: u64,
    /// Outbound bodies that reached Rust as bytes.
    pub raw_bodies: u64,
    /// Outbound bodies that reached Rust as a JSON array of numbers (the `postMessage` fallback).
    pub json_array_bodies: u64,
    /// Sends whose `seq` was not the next one when they arrived.
    pub out_of_order: u64,
    /// The most frames that ever waited for an earlier one.
    pub max_waiting: u64,
    /// Payload bytes sent to the page and not acknowledged, now.
    pub outstanding: u64,
    /// The most that were ever outstanding.
    pub max_outstanding: u64,
    /// Whether the read task may read the socket now.
    pub may_read: bool,
    /// How many times the window stopped the reading.
    pub pauses: u64,
    pub acks: u64,
    pub acked_bytes: u64,
    /// The window's high mark, for comparison.
    pub window_high_bytes: u64,
    /// Bytes of flood frames the server has handed to a socket, over all connections.
    pub server_fed_bytes: u64,
}

/// A group of frames that leave for the socket together (one frame, or one batch), and the answer.
struct Outgoing {
    messages: Vec<Message>,
    done: Done,
}

enum WriterMsg {
    Frames(Outgoing),
    Close { code: u16, reason: String },
}

/// One bridged socket.
struct Conn {
    order: Mutex<OrderBuffer<Outgoing>>,
    to_writer: mpsc::UnboundedSender<WriterMsg>,
    window: Mutex<InboundWindow>,
    /// A permit is stored when an acknowledgement arrives, so a read task that is about to wait
    /// cannot miss it.
    wake: Notify,
    /// The write task has sent the close frame: the read task ends.
    abort: Notify,
    counters: Counters,
    /// Why the connection broke, for the `closed` message.
    failure: Mutex<Option<BridgeError>>,
    /// The code and reason of a close the page asked for.
    local_close: Mutex<Option<(u16, String)>>,
}

impl Conn {
    /// Queue one outbound group under `seq`; the answer arrives once it is written.
    fn enqueue(&self, seq: u64, messages: Vec<Message>) -> Result<oneshot::Receiver<Result<(), BridgeError>>, BridgeError> {
        let (done, wait) = oneshot::channel();
        let mut ready = Vec::new();
        let pushed = {
            let mut order = lock(&self.order);
            if seq != order.expected() {
                self.counters.out_of_order.fetch_add(1, Relaxed);
            }
            let pushed = order.push(seq, Outgoing { messages, done }, Instant::now(), &mut ready);
            self.counters.max_waiting.fetch_max(order.waiting() as u64, Relaxed);
            if pushed.is_ok() {
                // Under the lock, so that two sends cannot interleave their releases. A writer that is
                // gone drops the group, and its sender with it: the waiting command answers `closed`.
                for outgoing in ready {
                    if self.to_writer.send(WriterMsg::Frames(outgoing)).is_err() {
                        break;
                    }
                }
            }
            pushed
        };
        match pushed {
            Ok(()) => Ok(wait),
            Err(e) => {
                let error = err(e.code(), e.to_string());
                self.fail(error.clone());
                Err(error)
            }
        }
    }

    async fn submit(&self, seq: u64, messages: Vec<Message>) -> Result<(), BridgeError> {
        let wait = self.enqueue(seq, messages)?;
        wait.await.unwrap_or_else(|_| Err(closed_error()))
    }

    /// The connection is broken (the order was violated): close it and drop what waits.
    fn fail(&self, error: BridgeError) {
        let reason = error.code.to_string();
        lock(&self.failure).get_or_insert(error);
        // Dropping the buffer drops the senders of the frames that wait: their commands answer `closed`.
        *lock(&self.order) = OrderBuffer::new();
        let _ = self.to_writer.send(WriterMsg::Close { code: 1008, reason });
    }

    async fn wait_until_readable(&self) {
        loop {
            if lock(&self.window).may_read() {
                return;
            }
            self.wake.notified().await;
        }
    }

    /// Sends one message to the page: `frames` WebSocket messages with `bytes` of payload. The window
    /// counts the bytes first, so that a reply cannot be acknowledged before it is counted.
    fn send_to_page(&self, channel: &Channel<InvokeResponseBody>, frames: u64, bytes: u64, body: InvokeResponseBody) -> Result<(), BridgeError> {
        let (outstanding, was_reading, reading) = {
            let mut window = lock(&self.window);
            let was_reading = window.may_read();
            window.on_sent(bytes);
            (window.outstanding(), was_reading, window.may_read())
        };
        let c = &self.counters;
        c.frames_in.fetch_add(frames, Relaxed);
        c.bytes_in.fetch_add(bytes, Relaxed);
        c.channel_messages.fetch_add(1, Relaxed);
        // Tauri evaluates a small message into the page and has the page fetch a larger one.
        let direct = match &body {
            InvokeResponseBody::Raw(raw) => raw.len() < TAURI_DIRECT_RAW_BYTES,
            InvokeResponseBody::Json(json) => json.len() < TAURI_DIRECT_JSON_BYTES,
        };
        if direct { &c.direct_messages } else { &c.fetched_messages }.fetch_add(1, Relaxed);
        c.max_outstanding.fetch_max(outstanding, Relaxed);
        if was_reading && !reading {
            c.pauses.fetch_add(1, Relaxed);
        }
        channel.send(body).map_err(channel_error)
    }

    fn stats(&self, server_fed_bytes: u64) -> Stats {
        let c = &self.counters;
        let (outstanding, may_read) = {
            let window = lock(&self.window);
            (window.outstanding(), window.may_read())
        };
        Stats {
            frames_in: c.frames_in.load(Relaxed),
            bytes_in: c.bytes_in.load(Relaxed),
            channel_messages: c.channel_messages.load(Relaxed),
            direct_messages: c.direct_messages.load(Relaxed),
            fetched_messages: c.fetched_messages.load(Relaxed),
            frames_out: c.frames_out.load(Relaxed),
            bytes_out: c.bytes_out.load(Relaxed),
            raw_bodies: c.raw_bodies.load(Relaxed),
            json_array_bodies: c.json_array_bodies.load(Relaxed),
            out_of_order: c.out_of_order.load(Relaxed),
            max_waiting: c.max_waiting.load(Relaxed),
            outstanding,
            max_outstanding: c.max_outstanding.load(Relaxed),
            may_read,
            pauses: c.pauses.load(Relaxed),
            acks: c.acks.load(Relaxed),
            acked_bytes: c.acked_bytes.load(Relaxed),
            window_high_bytes: WINDOW_HIGH_BYTES,
            server_fed_bytes,
        }
    }
}

/// The bridged sockets of this run. Managed by Tauri.
pub struct Bridge {
    port: u16,
    fed: Fed,
    registry: Registry,
    serial: AtomicU64,
}

impl Bridge {
    /// A bridge that dials only the benchmark's server on `127.0.0.1:port`.
    pub fn new(port: u16, fed: Fed) -> Self {
        Self { port, fed, registry: Arc::default(), serial: AtomicU64::new(0) }
    }

    /// A random 128-bit handle in hexadecimal. The standard library's hasher is seeded by the
    /// operating system; the handle guards nothing here, it only has the spec's shape.
    fn new_handle(&self) -> String {
        let n = self.serial.fetch_add(1, Relaxed);
        let (a, b) = (std::hash::RandomState::new().hash_one(n), std::hash::RandomState::new().hash_one(!n));
        format!("{a:016x}{b:016x}")
    }

    fn check_url(&self, url: &str) -> Result<(), BridgeError> {
        let prefix = format!("ws://127.0.0.1:{}", self.port);
        match url.strip_prefix(&prefix) {
            Some(path) if path.starts_with('/') => Ok(()),
            _ => Err(err("invalid_address", format!("the benchmark dials only {prefix}/<path>, not {url:?}"))),
        }
    }

    fn conn(&self, handle: &str) -> Result<Arc<Conn>, BridgeError> {
        lock(&self.registry).get(handle).cloned().ok_or_else(|| err("unknown_handle", "no such connection"))
    }

    /// Dial `url` and start the tasks. `channel` receives what the server sends.
    pub async fn open(&self, url: &str, inbound: Inbound, channel: Channel<InvokeResponseBody>) -> Result<String, BridgeError> {
        self.check_url(url)?;
        if lock(&self.registry).len() >= MAX_SOCKETS {
            return Err(err("limit", format!("{MAX_SOCKETS} bridged sockets are open")));
        }
        let ws =
            tokio::time::timeout(CONNECT_TIMEOUT, dial(self.port, url)).await.map_err(|_| err("connect_timeout", "the connection took more than 15 s"))??;
        let (sink, stream) = ws.split();
        let (to_writer, from_commands) = mpsc::unbounded_channel();
        let conn = Arc::new(Conn {
            order: Mutex::new(OrderBuffer::new()),
            to_writer,
            window: Mutex::new(InboundWindow::new()),
            wake: Notify::new(),
            abort: Notify::new(),
            counters: Counters::default(),
            failure: Mutex::new(None),
            local_close: Mutex::new(None),
        });
        let handle = self.new_handle();
        lock(&self.registry).insert(handle.clone(), conn.clone());
        tokio::spawn(write_loop(sink, from_commands, conn.clone()));
        tokio::spawn(read_loop(stream, conn, channel, inbound, self.registry.clone(), handle.clone()));
        Ok(handle)
    }

    pub async fn send_text(&self, handle: &str, seq: u64, data: String) -> Result<(), BridgeError> {
        let conn = self.conn(handle)?;
        too_large(data.len())?;
        conn.submit(seq, vec![Message::text(data)]).await
    }

    /// One binary frame: `body` is raw bytes, or (the `postMessage` fallback) a JSON array of numbers.
    pub async fn send_binary(&self, handle: &str, seq: u64, body: &InvokeBody) -> Result<(), BridgeError> {
        let conn = self.conn(handle)?;
        let bytes = body_bytes(&conn, body)?;
        too_large(bytes.len())?;
        conn.submit(seq, vec![Message::binary(bytes)]).await
    }

    /// Outbound variant (b): the frames of one batch (the codec's format) under one `seq`.
    pub async fn send_batch(&self, handle: &str, seq: u64, body: &InvokeBody) -> Result<(), BridgeError> {
        let conn = self.conn(handle)?;
        let bytes = body_bytes(&conn, body)?;
        let mut messages = Vec::new();
        for item in decode(&bytes) {
            match item.map_err(|e| err("bad_batch", e.to_string()))? {
                Item::Text(text) => messages.push(Message::text(text)),
                Item::Binary(data) => messages.push(Message::binary(data.to_vec())),
            }
        }
        conn.submit(seq, messages).await
    }

    pub fn ack(&self, handle: &str, bytes: u64) -> Result<(), BridgeError> {
        let conn = self.conn(handle)?;
        lock(&conn.window).on_ack(bytes).map_err(|e| err("bad_ack", e.to_string()))?;
        conn.counters.acks.fetch_add(1, Relaxed);
        conn.counters.acked_bytes.fetch_add(bytes, Relaxed);
        conn.wake.notify_one();
        Ok(())
    }

    /// Close a connection (an unknown handle is ignored) and answer its final counters.
    pub fn close(&self, handle: &str, code: Option<u16>, reason: Option<String>) -> Option<Stats> {
        let conn = lock(&self.registry).remove(handle)?;
        let code = code.filter(|c| matches!(c, 1000..=1003 | 1007..=1015 | 3000..=4999)).unwrap_or(1000);
        let _ = conn.to_writer.send(WriterMsg::Close { code, reason: reason.unwrap_or_default() });
        Some(conn.stats(self.fed.load(Relaxed)))
    }

    pub fn stats(&self, handle: &str) -> Result<Stats, BridgeError> {
        Ok(self.conn(handle)?.stats(self.fed.load(Relaxed)))
    }
}

fn too_large(len: usize) -> Result<(), BridgeError> {
    if len > MAX_MESSAGE_BYTES { Err(err("too_large", format!("{len} bytes: a message is at most {MAX_MESSAGE_BYTES}"))) } else { Ok(()) }
}

/// A raw body as bytes, counting which way it came.
fn body_bytes(conn: &Conn, body: &InvokeBody) -> Result<Vec<u8>, BridgeError> {
    match body {
        InvokeBody::Raw(bytes) => {
            conn.counters.raw_bodies.fetch_add(1, Relaxed);
            Ok(bytes.clone())
        }
        InvokeBody::Json(serde_json::Value::Array(items)) => {
            conn.counters.json_array_bodies.fetch_add(1, Relaxed);
            items
                .iter()
                .map(|v| v.as_u64().and_then(|n| u8::try_from(n).ok()))
                .collect::<Option<Vec<u8>>>()
                .ok_or_else(|| err("bad_body", "a JSON body holds something that is not a byte"))
        }
        InvokeBody::Json(_) => Err(err("bad_body", "a binary send needs a raw body or an array of bytes")),
    }
}

async fn dial(port: u16, url: &str) -> Result<Ws, BridgeError> {
    let connect = |e: std::io::Error| err("connect_failed", format!("cannot connect to 127.0.0.1:{port}: {e}"));
    let stream = TcpStream::connect(("127.0.0.1", port)).await.map_err(connect)?;
    // As the server's side: without it a small frame waits for the delayed-ACK timer.
    stream.set_nodelay(true).map_err(connect)?;
    let (ws, _) = client_async_with_config(url, stream, Some(WebSocketConfig::default()))
        .await
        .map_err(|e| err("upgrade_failed", format!("the WebSocket upgrade failed: {e}")))?;
    Ok(ws)
}

// ------------------------------------------------------------------------------------ writing

/// What one pass of the write task took from the queue.
#[derive(Default)]
struct Group {
    done: Vec<Done>,
    bytes: usize,
}

impl Group {
    fn finish(self, result: &Result<(), BridgeError>) {
        for done in self.done {
            let _ = done.send(result.clone());
        }
    }
}

async fn feed(sink: &mut Sink, conn: &Conn, group: &mut Group, outgoing: Outgoing) -> Result<(), BridgeError> {
    group.done.push(outgoing.done);
    for message in outgoing.messages {
        let len = message.len();
        sink.feed(message).await.map_err(|e| err("write_failed", e.to_string()))?;
        group.bytes += len;
        conn.counters.frames_out.fetch_add(1, Relaxed);
        conn.counters.bytes_out.fetch_add(len as u64, Relaxed);
    }
    Ok(())
}

/// Takes the queued frames (`first` and what follows, up to [`WRITE_FLUSH_BYTES`]), writes them and
/// flushes once. Returns the group (to answer), a close that was asked for, and the outcome.
async fn write_group(
    sink: &mut Sink,
    rx: &mut mpsc::UnboundedReceiver<WriterMsg>,
    conn: &Conn,
    first: WriterMsg,
) -> (Group, Option<(u16, String)>, Result<(), BridgeError>) {
    let mut group = Group::default();
    let mut close = None;
    let mut result = Ok(());
    let mut next = Some(first);
    while let Some(message) = next.take() {
        match message {
            WriterMsg::Frames(outgoing) => {
                result = feed(sink, conn, &mut group, outgoing).await;
                if result.is_err() || group.bytes >= WRITE_FLUSH_BYTES {
                    break;
                }
            }
            WriterMsg::Close { code, reason } => {
                close = Some((code, reason));
                break;
            }
        }
        next = rx.try_recv().ok();
    }
    if result.is_ok() {
        result = sink.flush().await.map_err(|e| err("write_failed", e.to_string()));
    }
    (group, close, result)
}

async fn write_loop(mut sink: Sink, mut rx: mpsc::UnboundedReceiver<WriterMsg>, conn: Arc<Conn>) {
    while let Some(first) = rx.recv().await {
        let (group, close, result) = write_group(&mut sink, &mut rx, &conn, first).await;
        group.finish(&result);
        if let Some((code, reason)) = close {
            let frame = CloseFrame { code: CloseCode::from(code), reason: reason.clone().into() };
            let _ = sink.send(Message::Close(Some(frame))).await;
            *lock(&conn.local_close) = Some((code, reason));
            conn.abort.notify_one();
            break;
        }
        if let Err(error) = result {
            lock(&conn.failure).get_or_insert(error);
            conn.abort.notify_one();
            break;
        }
    }
    // Whoever is still waiting for an answer gets one.
    rx.close();
    while let Ok(message) = rx.try_recv() {
        if let WriterMsg::Frames(outgoing) = message {
            let _ = outgoing.done.send(Err(closed_error()));
        }
    }
}

// ------------------------------------------------------------------------------------ reading

/// How a connection ended, for the page's `closed` message.
struct Closed {
    code: u16,
    reason: String,
    error: Option<BridgeError>,
}

/// Frames waiting to go to the page as one batch.
#[derive(Default)]
struct Batch {
    bytes: Vec<u8>,
    frames: u64,
    payload: u64,
}

impl Batch {
    /// The batch goes to the page as one message (if any frame waits).
    fn flush(&mut self, conn: &Conn, channel: &Channel<InvokeResponseBody>) -> Result<(), BridgeError> {
        if self.frames == 0 {
            return Ok(());
        }
        let bytes = std::mem::take(&mut self.bytes);
        let (frames, payload) = (self.frames, self.payload);
        self.frames = 0;
        self.payload = 0;
        conn.send_to_page(channel, frames, payload, InvokeResponseBody::Raw(bytes))
    }
}

fn channel_error(e: impl std::fmt::Display) -> BridgeError {
    err("channel_failed", e.to_string())
}

/// One WebSocket message, forwarded in the chosen way. `Some` ends the connection.
fn forward(conn: &Conn, channel: &Channel<InvokeResponseBody>, mode: Inbound, batch: &mut Batch, message: Message) -> Result<Option<Closed>, BridgeError> {
    match (message, mode) {
        (Message::Text(text), Inbound::Frame) => {
            let json = serde_json::to_string(text.as_str()).map_err(channel_error)?;
            conn.send_to_page(channel, 1, text.len() as u64, InvokeResponseBody::Json(json))?;
        }
        (Message::Binary(bytes), Inbound::Frame) => {
            conn.send_to_page(channel, 1, bytes.len() as u64, InvokeResponseBody::Raw(bytes.to_vec()))?;
        }
        (Message::Text(text), Inbound::Batch) => {
            encode_text(&mut batch.bytes, text.as_str()).map_err(|e| err("bad_frame", e.to_string()))?;
            batch.payload += text.len() as u64;
            batch.frames += 1;
        }
        (Message::Binary(bytes), Inbound::Batch) => {
            encode_binary(&mut batch.bytes, &bytes).map_err(|e| err("bad_frame", e.to_string()))?;
            batch.payload += bytes.len() as u64;
            batch.frames += 1;
        }
        (Message::Close(frame), _) => {
            let (code, reason) = frame.map_or((1005, String::new()), |f| (u16::from(f.code), f.reason.to_string()));
            return Ok(Some(Closed { code, reason, error: None }));
        }
        _ => {}
    }
    if batch.bytes.len() >= BATCH_FLUSH_BYTES {
        batch.flush(conn, channel)?;
    }
    Ok(None)
}

/// The next message, or `None` when a batch is waiting and the socket has nothing more right now.
async fn next_message(stream: &mut SplitStream<Ws>, batch_waiting: bool) -> Option<Option<Result<Message, tokio_tungstenite::tungstenite::Error>>> {
    if batch_waiting { stream.next().now_or_never() } else { Some(stream.next().await) }
}

/// Reads the socket until it ends, the page leaves or the connection breaks.
async fn read_messages(stream: &mut SplitStream<Ws>, conn: &Conn, channel: &Channel<InvokeResponseBody>, mode: Inbound) -> Result<Closed, BridgeError> {
    let mut batch = Batch::default();
    loop {
        conn.wait_until_readable().await;
        let Some(next) = next_message(stream, batch.frames > 0).await else {
            // The socket has nothing more to give right now: what waits goes to the page.
            batch.flush(conn, channel)?;
            continue;
        };
        match next {
            None => {
                batch.flush(conn, channel)?;
                return Ok(Closed { code: 1006, reason: String::new(), error: None });
            }
            Some(Err(e)) => {
                batch.flush(conn, channel)?;
                return Ok(Closed { code: 1006, reason: String::new(), error: Some(err("read_failed", e.to_string())) });
            }
            Some(Ok(message)) => {
                if let Some(closed) = forward(conn, channel, mode, &mut batch, message)? {
                    batch.flush(conn, channel)?;
                    return Ok(closed);
                }
            }
        }
    }
}

async fn read_loop(mut stream: SplitStream<Ws>, conn: Arc<Conn>, channel: Channel<InvokeResponseBody>, mode: Inbound, registry: Registry, handle: String) {
    let mut closed = tokio::select! {
        result = read_messages(&mut stream, &conn, &channel, mode) => result.unwrap_or_else(|error| Closed { code: 1006, reason: String::new(), error: Some(error) }),
        () = conn.abort.notified() => Closed { code: 1006, reason: String::new(), error: None },
    };
    // A close the page asked for wins over what the server did in answer (a reset, its own close frame).
    if let Some((code, reason)) = lock(&conn.local_close).take() {
        (closed.code, closed.reason) = (code, reason);
    }
    lock(&registry).remove(&handle);
    let _ = conn.to_writer.send(WriterMsg::Close { code: 1000, reason: String::new() });
    let error = closed.error.or_else(|| lock(&conn.failure).clone());
    let message = serde_json::json!({ "closed": { "code": closed.code, "reason": closed.reason, "error": error } });
    let _ = channel.send(InvokeResponseBody::Json(message.to_string()));
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::frame::{self, StreamCheck};
    use crate::server::{self, Switches};

    struct Harness {
        bridge: Bridge,
        fed: Fed,
        port: u16,
    }

    async fn harness() -> Harness {
        let listener = std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        let fed = Fed::default();
        tokio::spawn(server::serve(listener, Switches::default(), fed.clone()));
        Harness { bridge: Bridge::new(port, fed.clone()), fed, port }
    }

    fn collector() -> (Channel<InvokeResponseBody>, mpsc::UnboundedReceiver<InvokeResponseBody>) {
        let (tx, rx) = mpsc::unbounded_channel();
        (
            Channel::new(move |body| {
                let _ = tx.send(body);
                Ok(())
            }),
            rx,
        )
    }

    impl Harness {
        async fn open(&self, path: &str, mode: Inbound) -> (String, mpsc::UnboundedReceiver<InvokeResponseBody>) {
            let (channel, rx) = collector();
            let handle = self.bridge.open(&format!("ws://127.0.0.1:{}{path}", self.port), mode, channel).await.unwrap();
            (handle, rx)
        }
    }

    /// What a page would do with the channel's messages of a flood: check the frames, acknowledge
    /// them, stop at the server's `done` message.
    struct Page {
        check: StreamCheck,
        messages: usize,
        biggest_batch: usize,
        done: Option<serde_json::Value>,
        closed: Option<serde_json::Value>,
    }

    impl Page {
        fn new() -> Self {
            Self { check: StreamCheck::default(), messages: 0, biggest_batch: 0, done: None, closed: None }
        }

        /// Takes one channel message; returns the payload bytes it carried.
        fn take(&mut self, body: InvokeResponseBody, mode: Inbound) -> u64 {
            self.messages += 1;
            match (body, mode) {
                (InvokeResponseBody::Raw(bytes), Inbound::Frame) => {
                    self.check.accept_binary(&bytes);
                    bytes.len() as u64
                }
                (InvokeResponseBody::Raw(bytes), Inbound::Batch) => {
                    self.biggest_batch = self.biggest_batch.max(bytes.len());
                    for item in decode(&bytes) {
                        match item.unwrap() {
                            Item::Binary(b) => self.check.accept_binary(b),
                            Item::Text(t) => self.text(t),
                        }
                    }
                    item_len(&bytes)
                }
                (InvokeResponseBody::Json(json), _) => {
                    let value: serde_json::Value = serde_json::from_str(&json).unwrap();
                    match value {
                        serde_json::Value::String(text) => {
                            self.text(&text);
                            text.len() as u64
                        }
                        other => {
                            self.closed = Some(other["closed"].clone());
                            0
                        }
                    }
                }
            }
        }

        fn text(&mut self, text: &str) {
            match serde_json::from_str::<serde_json::Value>(text) {
                Ok(done) => self.done = Some(done),
                Err(_) => self.check.accept_text(text),
            }
        }
    }

    /// The payload bytes of a whole batch.
    fn item_len(batch: &[u8]) -> u64 {
        decode(batch).map(|i| i.unwrap().payload_len() as u64).sum()
    }

    async fn run_flood(h: &Harness, query: &str, mode: Inbound) -> (Page, Stats) {
        let (handle, mut rx) = h.open(&format!("/flood?{query}"), mode).await;
        h.bridge.send_text(&handle, 0, "go".into()).await.unwrap();
        let mut page = Page::new();
        while page.done.is_none() {
            let body = rx.recv().await.unwrap();
            let payload = page.take(body, mode);
            if payload > 0 {
                h.bridge.ack(&handle, payload).unwrap();
            }
        }
        let stats = h.bridge.stats(&handle).unwrap();
        h.bridge.close(&handle, None, None);
        (page, stats)
    }

    #[test]
    fn modes_and_addresses_are_checked() {
        assert_eq!(Inbound::parse("frame"), Ok(Inbound::Frame));
        assert_eq!(Inbound::parse("batch"), Ok(Inbound::Batch));
        assert_eq!(Inbound::parse("both").unwrap_err().code, "invalid_mode");
        let bridge = Bridge::new(4000, Fed::default());
        assert!(bridge.check_url("ws://127.0.0.1:4000/echo").is_ok());
        for bad in
            ["ws://127.0.0.1:4001/echo", "ws://127.0.0.1:4000", "wss://127.0.0.1:4000/echo", "ws://example.com:4000/echo", "ws://127.0.0.1:40001/echo", ""]
        {
            assert_eq!(bridge.check_url(bad).unwrap_err().code, "invalid_address", "{bad:?}");
        }
        assert_ne!(bridge.new_handle(), bridge.new_handle());
        assert_eq!(bridge.new_handle().len(), 32);
        assert_eq!(bridge.stats("nope").unwrap_err().code, "unknown_handle");
        assert!(bridge.close("nope", None, None).is_none());
    }

    #[tokio::test]
    async fn a_flood_arrives_whole_one_message_per_frame() {
        let h = harness().await;
        let (page, stats) = run_flood(&h, "frames=300&size=4096", Inbound::Frame).await;
        assert_eq!(page.check.report().error_count, 0);
        let done = page.done.unwrap();
        assert_eq!(done["frames"], 300);
        assert_eq!(done["hash"], page.check.report().hash.as_str());
        // 300 binary frames and the server's closing text: one channel message each.
        assert_eq!((stats.frames_in, stats.channel_messages), (301, 301));
        // 4 KiB raw messages are fetched by the page; the closing text is small enough to be evaluated into it.
        assert_eq!((stats.fetched_messages, stats.direct_messages), (300, 1));
        assert_eq!(stats.bytes_in, 300 * 4096 + done.to_string().len() as u64);
        assert_eq!(stats.outstanding, 0);
        assert_eq!(stats.raw_bodies, 0);
    }

    #[tokio::test]
    async fn a_flood_arrives_whole_in_batches() {
        let h = harness().await;
        for query in ["frames=400&size=4096", "frames=600&size=200&kind=text"] {
            let (page, stats) = run_flood(&h, query, Inbound::Batch).await;
            assert_eq!(page.check.report().error_count, 0, "{query}");
            let done = page.done.unwrap();
            assert_eq!(done["hash"], page.check.report().hash.as_str(), "{query}");
            let frames = done["frames"].as_u64().unwrap();
            assert_eq!(stats.frames_in, frames + 1, "{query}");
            assert!(stats.channel_messages * 2 < stats.frames_in, "{query}: {} messages for {} frames", stats.channel_messages, stats.frames_in);
            // A batch is flushed at 64 KiB: it may pass it by one frame, not by more.
            assert!(page.biggest_batch <= 64 * 1024 + 4096 + 5, "{query}: {}", page.biggest_batch);
            assert_eq!(stats.outstanding, 0, "{query}");
        }
    }

    /// The page never acknowledges: Rust stops reading just past 8 MiB and the server's sends stall;
    /// acknowledging lets the flood finish, whole.
    async fn window_stops_the_reading(mode: Inbound, frame: usize) {
        use std::sync::atomic::Ordering::Relaxed;
        let h = harness().await;
        let frames = 96 * 1024 * 1024 / frame;
        let (handle, mut rx) = h.open(&format!("/flood?frames={frames}&size={frame}"), mode).await;
        h.bridge.send_text(&handle, 0, "go".into()).await.unwrap();
        let mut page = Page::new();
        let mut stable = 0;
        let mut last = (0, 0);
        while stable < 6 {
            tokio::time::sleep(Duration::from_millis(100)).await;
            while let Ok(body) = rx.try_recv() {
                page.take(body, mode);
            }
            let now = (h.bridge.stats(&handle).unwrap().bytes_in, h.fed.load(Relaxed));
            stable = if now == last { stable + 1 } else { 0 };
            last = now;
        }
        let stats = h.bridge.stats(&handle).unwrap();
        let high = WINDOW_HIGH_BYTES;
        assert!(stats.outstanding > high && stats.outstanding <= high + 64 * 1024 + frame as u64, "{mode:?}: {} outstanding", stats.outstanding);
        assert!(!stats.may_read);
        assert_eq!(stats.pauses, 1);
        assert!(stats.server_fed_bytes < (frames * frame) as u64, "the server stalled: {} of {} bytes sent", stats.server_fed_bytes, frames * frame);
        assert!(page.done.is_none());
        // Acknowledge what the page has: the flood resumes and arrives whole.
        let mut owed = stats.outstanding;
        while page.done.is_none() {
            h.bridge.ack(&handle, owed).unwrap();
            owed = 0;
            let body = rx.recv().await.unwrap();
            owed += page.take(body, mode);
        }
        assert_eq!(page.check.report().error_count, 0);
        assert_eq!(page.done.unwrap()["hash"], page.check.report().hash.as_str());
    }

    #[tokio::test]
    async fn without_acknowledgements_the_reading_stops_at_the_window_per_frame() {
        window_stops_the_reading(Inbound::Frame, 64 * 1024).await;
    }

    #[tokio::test]
    async fn without_acknowledgements_the_reading_stops_at_the_window_in_batches() {
        window_stops_the_reading(Inbound::Batch, 64 * 1024).await;
    }

    #[tokio::test]
    async fn an_acknowledgement_of_more_than_was_sent_is_refused() {
        let h = harness().await;
        let (handle, _rx) = h.open("/echo", Inbound::Frame).await;
        assert_eq!(h.bridge.ack(&handle, 1).unwrap_err().code, "bad_ack");
        h.bridge.close(&handle, None, None);
    }

    fn frame_of(counter: u32) -> Vec<u8> {
        frame::binary_frame(&frame::binary_template(32).unwrap(), counter).0
    }

    /// Sends the 32-byte frame whose counter is `seq`, as raw bytes under that `seq`.
    async fn send_frame(h: &Harness, handle: &str, seq: u64) -> Result<(), BridgeError> {
        let body = InvokeBody::Raw(frame_of(seq as u32));
        h.bridge.send_binary(handle, seq, &body).await
    }

    #[tokio::test]
    async fn sends_that_arrive_out_of_order_are_written_in_order() {
        let h = harness().await;
        let (handle, mut rx) = h.open("/echo", Inbound::Frame).await;
        let send = |seq: u64| send_frame(&h, &handle, seq);
        // Arrival order 2, 0, 1: 2 waits, 0 passes, 1 releases itself and 2.
        let (a, b, c) = tokio::join!(send(2), send(0), send(1));
        assert_eq!((a, b, c), (Ok(()), Ok(()), Ok(())));
        for expected in 0..3u32 {
            let InvokeResponseBody::Raw(echoed) = rx.recv().await.unwrap() else { panic!("not raw") };
            assert_eq!(echoed, frame_of(expected));
        }
        let stats = h.bridge.stats(&handle).unwrap();
        assert_eq!((stats.out_of_order, stats.max_waiting, stats.frames_out, stats.raw_bodies), (1, 1, 3, 3));
        h.bridge.close(&handle, None, None);
    }

    #[tokio::test]
    async fn a_repeated_seq_breaks_the_connection_with_send_order() {
        let h = harness().await;
        let (handle, mut rx) = h.open("/echo", Inbound::Frame).await;
        // seq 1 waits for 0; the same seq again is a duplicate: the connection closes, the waiting send fails.
        let (waiting, duplicate) = tokio::join!(send_frame(&h, &handle, 1), send_frame(&h, &handle, 1));
        assert_eq!(duplicate.unwrap_err().code, "send_order");
        assert_eq!(waiting.unwrap_err().code, "closed");
        let mut page = Page::new();
        while page.closed.is_none() {
            let body = rx.recv().await.unwrap();
            page.take(body, Inbound::Frame);
        }
        let closed = page.closed.unwrap();
        assert_eq!(closed["error"]["code"], "send_order");
    }

    #[tokio::test]
    async fn a_batch_goes_out_as_its_frames_and_a_bad_one_is_refused() {
        let h = harness().await;
        let (handle, mut rx) = h.open("/echo", Inbound::Frame).await;
        let mut batch = Vec::new();
        encode_binary(&mut batch, &frame_of(0)).unwrap();
        encode_binary(&mut batch, &frame_of(1)).unwrap();
        h.bridge.send_batch(&handle, 0, &InvokeBody::Raw(batch)).await.unwrap();
        for expected in 0..2u32 {
            let InvokeResponseBody::Raw(echoed) = rx.recv().await.unwrap() else { panic!("not raw") };
            assert_eq!(echoed, frame_of(expected));
        }
        let refused = h.bridge.send_batch(&handle, 1, &InvokeBody::Raw(vec![9, 1, 0, 0, 0, 7])).await;
        assert_eq!(refused.unwrap_err().code, "bad_batch");
        assert_eq!(h.bridge.stats(&handle).unwrap().frames_out, 2);
        h.bridge.close(&handle, None, None);
    }

    #[tokio::test]
    async fn a_json_array_body_is_counted_and_a_bad_one_refused() {
        let h = harness().await;
        let (handle, mut rx) = h.open("/echo", Inbound::Frame).await;
        let array = serde_json::json!(frame_of(0));
        h.bridge.send_binary(&handle, 0, &InvokeBody::Json(array)).await.unwrap();
        let InvokeResponseBody::Raw(echoed) = rx.recv().await.unwrap() else { panic!("not raw") };
        assert_eq!(echoed, frame_of(0));
        let stats = h.bridge.stats(&handle).unwrap();
        assert_eq!((stats.raw_bodies, stats.json_array_bodies), (0, 1));
        for bad in [serde_json::json!([1, 256]), serde_json::json!([1, "x"]), serde_json::json!({ "a": 1 })] {
            let refused = h.bridge.send_binary(&handle, 1, &InvokeBody::Json(bad)).await;
            assert_eq!(refused.unwrap_err().code, "bad_body");
        }
        h.bridge.close(&handle, None, None);
    }

    #[tokio::test]
    async fn text_goes_out_and_a_close_ends_the_connection_with_its_code() {
        let h = harness().await;
        let (handle, mut rx) = h.open("/echo", Inbound::Frame).await;
        h.bridge.send_text(&handle, 0, "héllo".into()).await.unwrap();
        let InvokeResponseBody::Json(echoed) = rx.recv().await.unwrap() else { panic!("not json") };
        assert_eq!(echoed, "\"héllo\"");
        let final_stats = h.bridge.close(&handle, Some(4001), Some("bye".into())).unwrap();
        assert_eq!((final_stats.frames_out, final_stats.frames_in), (1, 1));
        assert!(h.bridge.close(&handle, None, None).is_none(), "closing again is ignored");
        let InvokeResponseBody::Json(closed) = rx.recv().await.unwrap() else { panic!("not json") };
        let closed: serde_json::Value = serde_json::from_str(&closed).unwrap();
        assert_eq!((closed["closed"]["code"].as_u64(), closed["closed"]["reason"].as_str()), (Some(4001), Some("bye")));
        assert_eq!(h.bridge.send_text(&handle, 1, "x".into()).await.unwrap_err().code, "unknown_handle");
    }

    #[tokio::test]
    async fn at_most_four_sockets_and_only_the_servers_address() {
        let h = harness().await;
        let mut handles = Vec::new();
        for _ in 0..MAX_SOCKETS {
            handles.push(h.open("/echo", Inbound::Frame).await);
        }
        let (channel, _rx) = collector();
        let refused = h.bridge.open(&format!("ws://127.0.0.1:{}/echo", h.port), Inbound::Frame, channel).await;
        assert_eq!(refused.unwrap_err().code, "limit");
        let (channel, _rx) = collector();
        assert_eq!(h.bridge.open("ws://127.0.0.1:1/echo", Inbound::Frame, channel).await.unwrap_err().code, "invalid_address");
        for (handle, _) in &handles {
            h.bridge.close(handle, None, None);
        }
        let (channel, _rx) = collector();
        let refused = h.bridge.open(&format!("ws://127.0.0.1:{}/nope", h.port), Inbound::Frame, channel).await;
        assert_eq!(refused.unwrap_err().code, "upgrade_failed");
    }
}
