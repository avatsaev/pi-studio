//! What the save's tests share: a connection to the stand-in, a scripted daemon over an in-memory
//! pipe, a sink that fails, waits and counts, and a cancel that a test fires.

use std::io;
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::{Duration, Instant};

use futures_util::{SinkExt, StreamExt};
use pistudiodesktop_net::dial;
use serde_json::{Value, json};
use tokio::io::{DuplexStream, duplex};
use tokio::sync::{Notify, Semaphore, mpsc};
use tokio::task::JoinHandle;
use tokio::time::timeout;
use tokio_tungstenite::WebSocketStream;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::tungstenite::protocol::{Role, WebSocketConfig};

use crate::Limits;
use crate::connection::{Connection, Hello};
use crate::download::{MemorySink, Request, SaveError, Saved, Sink, Version, save};
use crate::testing::StandInDaemon;

pub const APP: Hello<'static> = Hello { client_id: "client-1", app_version: "pistudiodesktop/test" };

/// How long a test waits (on the paused clock) for something that must happen.
pub const PATIENCE: Duration = Duration::from_secs(600);

/// Bytes that are not periodic within a chunk, the same for the same `len` and `seed`.
pub fn content(len: usize, seed: u8) -> Vec<u8> {
    (0..len).map(|index| u8::try_from((index * 31 + index / 251 + usize::from(seed)) % 256).unwrap_or(0)).collect()
}

/// A connection to the stand-in over a real socket.
pub async fn connect(daemon: &StandInDaemon, limits: Limits) -> Connection {
    let socket = dial(&daemon.url(), None, Duration::from_secs(5), limits.max_message_bytes).await.expect("the stand-in accepts the dial");
    Connection::open(socket, &APP, limits).await.expect("the handshake succeeds")
}

/// Waits, in real time, until `done`; a test that waits more than ten seconds has failed.
pub async fn eventually(what: &str, mut done: impl FnMut() -> bool) {
    let start = Instant::now();
    while !done() {
        assert!(start.elapsed() < Duration::from_secs(10), "{what} did not happen within ten seconds");
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
}

/// Whether every one of the connection's 256 streams is free: it takes them all, and lets them go.
pub fn all_streams_free(connection: &Connection) -> bool {
    let taken: Vec<_> = (0..256).map_while(|_| connection.download().ok()).collect();
    taken.len() == 256
}

/// How many of the connection's 256 streams are free.
pub fn free_streams(connection: &Connection) -> usize {
    let taken: Vec<_> = (0..256).map_while(|_| connection.download().ok()).collect();
    taken.len()
}

/// A cancel that a test fires: `cancelled()` completes after `cancel()`, whether that was before or after it is awaited.
#[derive(Clone, Default)]
pub struct Trigger(Arc<Notify>);

impl Trigger {
    pub fn cancel(&self) {
        self.0.notify_one();
    }

    pub async fn cancelled(self) {
        self.0.notified().await;
    }
}

/// A sink in memory that can wait, fail and tell a test what it was given.
#[derive(Default)]
pub struct TestSink {
    pub inner: MemorySink,
    /// Bytes counted as written before this sink's own, so that a resume can start beyond what memory holds.
    pub before: u64,
    /// The write with this index (from 0) fails.
    pub fail_write_at: Option<usize>,
    pub fail_finish: bool,
    /// Every write takes one permit first.
    pub gate: Option<Arc<Semaphore>>,
    /// Every write waits this long (on the tokio clock).
    pub delay: Duration,
    /// Called with the write's index before each write.
    pub on_write: Option<Box<dyn FnMut(usize) + Send>>,
    pub writes: usize,
    /// The `written` count the sink claims once it has been written to, whatever it holds.
    pub lie: Option<u64>,
}

impl TestSink {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn holding(bytes: Vec<u8>) -> Self {
        Self { inner: MemorySink::with_bytes(bytes), ..Self::default() }
    }

    pub fn bytes(&self) -> &[u8] {
        self.inner.bytes()
    }
}

impl Sink for TestSink {
    fn written(&self) -> u64 {
        match self.lie {
            Some(lie) if self.writes > 0 => lie,
            _ => self.before + self.inner.written(),
        }
    }

    async fn write(&mut self, data: &[u8]) -> io::Result<()> {
        let index = self.writes;
        self.writes += 1;
        if let Some(hook) = self.on_write.as_mut() {
            hook(index);
        }
        if let Some(gate) = &self.gate {
            gate.acquire().await.expect("the gate stays open").forget();
        }
        if !self.delay.is_zero() {
            tokio::time::sleep(self.delay).await;
        }
        if self.fail_write_at == Some(index) {
            return Err(io::Error::other("the disk is full"));
        }
        self.inner.write(data).await
    }

    async fn finish(&mut self) -> io::Result<()> {
        if self.fail_finish {
            return Err(io::Error::other("the file could not be put in place"));
        }
        self.inner.finish().await
    }

    async fn discard(&mut self) {
        self.inner.discard().await;
    }
}

// ---- the scripted daemon ----

/// The client's end of a pipe of `room` bytes each way, and the daemon's.
async fn pair(limits: &Limits, room: usize) -> (WebSocketStream<DuplexStream>, WebSocketStream<DuplexStream>) {
    let (client, daemon) = duplex(room);
    let config = WebSocketConfig::default().max_message_size(Some(limits.max_message_bytes)).max_frame_size(Some(limits.max_message_bytes));
    let client = WebSocketStream::from_raw_socket(client, Role::Client, Some(config)).await;
    let daemon = WebSocketStream::from_raw_socket(daemon, Role::Server, None).await;
    (client, daemon)
}

/// A daemon that the test drives frame by frame. It reads in a task of its own, tells the test what
/// it read, sends what the test tells it to, and answers pings.
pub struct Daemon {
    commands: mpsc::UnboundedSender<Message>,
    seen: mpsc::UnboundedReceiver<Message>,
    delivered: Arc<AtomicUsize>,
}

impl Daemon {
    fn spawn(mut ws: WebSocketStream<DuplexStream>) -> Self {
        let (commands, mut commands_rx) = mpsc::unbounded_channel::<Message>();
        let (seen_tx, seen) = mpsc::unbounded_channel();
        let delivered = Arc::new(AtomicUsize::new(0));
        let counter = Arc::clone(&delivered);
        tokio::spawn(async move {
            loop {
                tokio::select! {
                    command = commands_rx.recv() => match command {
                        Some(message) => {
                            if ws.send(message).await.is_err() {
                                break;
                            }
                            counter.fetch_add(1, Ordering::SeqCst);
                        }
                        // The test is done with the daemon: the pipe goes away with it.
                        None => break,
                    },
                    message = ws.next() => match message {
                        Some(Ok(message)) => {
                            if let Some(pong) = pong_for(&message) {
                                let _ = ws.send(pong).await;
                            }
                            let _ = seen_tx.send(message);
                        }
                        Some(Err(_)) | None => break,
                    },
                }
            }
        });
        Self { commands, seen, delivered }
    }

    pub fn send(&self, message: Message) {
        let _ = self.commands.send(message);
    }

    pub fn send_json(&self, frame: &Value) {
        self.send(Message::text(frame.to_string()));
    }

    pub fn send_binary(&self, frame: Vec<u8>) {
        self.send(Message::binary(frame));
    }

    /// How many frames the daemon has pushed into the pipe.
    pub fn delivered(&self) -> usize {
        self.delivered.load(Ordering::SeqCst)
    }

    /// The next `session` message the daemon read: a request. Pings are skipped.
    pub async fn request(&mut self) -> Value {
        loop {
            let message = timeout(PATIENCE, self.seen.recv())
                .await
                .expect("the daemon read nothing within the patience")
                .expect("the pipe ended while waiting for a request");
            if let Message::Text(text) = &message
                && let Ok(frame) = serde_json::from_str::<Value>(text.as_str())
                && frame["type"] == "session"
            {
                return frame["message"].clone();
            }
        }
    }

    /// Every request the daemon has read so far and nobody took.
    pub fn requests_so_far(&mut self) -> Vec<Value> {
        let mut all = Vec::new();
        while let Ok(message) = self.seen.try_recv() {
            if let Message::Text(text) = &message
                && let Ok(frame) = serde_json::from_str::<Value>(text.as_str())
                && frame["type"] == "session"
            {
                all.push(frame["message"].clone());
            }
        }
        all
    }

    /// Drops the pipe: the client's reads end with no close frame.
    pub fn vanish(self) {
        drop(self);
    }
}

fn pong_for(message: &Message) -> Option<Message> {
    let Message::Text(text) = message else { return None };
    let ping: Value = serde_json::from_str(text.as_str()).ok()?;
    if ping["type"] != "ping" {
        return None;
    }
    Some(Message::text(
        json!({ "type": "pong", "requestId": ping["requestId"], "clientSentAt": ping["clientSentAt"], "serverReceivedAt": 1, "serverSentAt": 2 }).to_string(),
    ))
}

/// Opens a connection over a pipe of `room` bytes with a daemon that answers the handshake.
pub async fn scripted_with(limits: Limits, room: usize) -> (Arc<Connection>, Daemon) {
    let (client, mut ws) = pair(&limits, room).await;
    let hello_and_status = async {
        let _hello = ws.next().await;
        let status = json!({ "type": "status", "payload": { "status": "server_info", "features": { "fileDownloadRanges": true, "fileTransferAck": true, "agentStreamsMode": true } } });
        ws.send(Message::text(status.to_string())).await.expect("the pipe takes the status");
    };
    let (opened, ()) = tokio::join!(Connection::open(client, &APP, limits), hello_and_status);
    (Arc::new(opened.expect("the handshake succeeds")), Daemon::spawn(ws))
}

pub async fn scripted() -> (Arc<Connection>, Daemon) {
    scripted_with(Limits::default(), 40 * 1024 * 1024).await
}

// ---- frames ----

pub fn request_id(request: &Value) -> String {
    request["requestId"].as_str().expect("a request has a requestId").to_owned()
}

/// A `session` message that answers a request.
pub fn answer(request_id: &str, kind: &str, fields: &Value) -> Value {
    let mut message = json!({ "type": kind, "requestId": request_id });
    if let (Some(message), Some(fields)) = (message.as_object_mut(), fields.as_object()) {
        message.extend(fields.clone());
    }
    json!({ "type": "session", "message": message })
}

/// What a download's answer and `Begin` say.
#[derive(Clone, Copy)]
pub struct Range {
    pub stream: u8,
    pub total: u64,
    pub mtime: u64,
    pub offset: u64,
    pub length: u64,
}

impl Range {
    /// A whole file of `total` bytes on `stream`.
    pub fn whole(stream: u8, total: u64) -> Self {
        Self { stream, total, mtime: 7, offset: 0, length: total }
    }

    /// The same file, from `offset` to its end.
    pub fn from(self, offset: u64) -> Self {
        Self { offset, length: self.total - offset, ..self }
    }
}

pub fn accepted(request_id: &str, range: Range) -> Value {
    answer(
        request_id,
        "file_download_response",
        &json!({ "ok": true, "stream": range.stream, "transferId": "d-1", "totalBytes": range.total, "mtimeMs": range.mtime, "offset": range.offset, "length": range.length }),
    )
}

pub fn refused(request_id: &str, error: &str) -> Value {
    answer(request_id, "file_download_response", &json!({ "ok": false, "error": error }))
}

pub fn cancel_answer(request_id: &str, ok: bool) -> Value {
    if ok {
        answer(request_id, "file_download_cancel_response", &json!({ "ok": true }))
    } else {
        answer(request_id, "file_download_cancel_response", &json!({ "ok": false, "error": "not_found" }))
    }
}

pub fn begin(range: Range) -> Vec<u8> {
    let mut frame = vec![0x10, range.stream];
    frame.extend(
        json!({ "transferId": "d-1", "fileName": "f", "totalBytes": range.total, "mtimeMs": range.mtime, "offset": range.offset, "length": range.length })
            .to_string()
            .as_bytes(),
    );
    frame
}

pub fn chunk(stream: u8, data: &[u8]) -> Vec<u8> {
    let mut frame = vec![0x11, stream];
    frame.extend_from_slice(data);
    frame
}

pub fn end(stream: u8) -> Vec<u8> {
    vec![0x12, stream, 1]
}

pub fn error_frame(stream: u8, message: &str) -> Vec<u8> {
    let mut frame = vec![0x13, stream];
    frame.extend_from_slice(message.as_bytes());
    frame
}

/// Lets the other tasks run until `done`, on the paused clock: for something that happens without time passing.
pub async fn settle_until(what: &str, mut done: impl FnMut() -> bool) {
    for _ in 0..10_000 {
        if done() {
            return;
        }
        tokio::task::yield_now().await;
    }
    panic!("{what} did not happen");
}

/// A save of `/srv/f` running in a task of its own, with the trigger of its cancel.
pub struct Saving {
    pub task: JoinHandle<Finished>,
    pub trigger: Trigger,
}

/// How a save ended, and the sink it was given back.
pub type Finished = (Result<Saved, SaveError>, TestSink);

pub fn start(connection: &Arc<Connection>, mut sink: TestSink, resume: Option<Version>) -> Saving {
    let trigger = Trigger::default();
    let task = tokio::spawn({
        let connection = Arc::clone(connection);
        let cancelled = trigger.clone().cancelled();
        async move {
            let result = save(&connection, Request { path: "/srv/f", resume }, &mut sink, |_| {}, cancelled, &Limits::default()).await;
            (result, sink)
        }
    });
    Saving { task, trigger }
}

/// The stream a request names.
pub fn stream_of(request: &Value) -> u8 {
    u8::try_from(request["stream"].as_u64().expect("the request names a stream")).expect("a stream is a byte")
}

/// Lets the other tasks run for a while without moving the clock.
pub async fn spin() {
    for _ in 0..200 {
        tokio::task::yield_now().await;
    }
}
