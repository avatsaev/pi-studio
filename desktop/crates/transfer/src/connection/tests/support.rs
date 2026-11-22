//! What the connection's tests share: a scripted daemon over an in-memory pipe, and the frames it sends.
//!
//! The pipe has no real input or output, so a test that pauses the clock moves time exactly:
//! the runtime advances it only when every task waits for a timer. Tests that need a real socket use
//! the stand-in daemon (`standin.rs`).

use std::sync::Arc;
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use serde_json::{Value, json};
use tokio::io::{DuplexStream, duplex};
use tokio::sync::mpsc;
use tokio::time::{Instant, timeout};
use tokio_tungstenite::WebSocketStream;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::tungstenite::protocol::frame::coding::CloseCode;
use tokio_tungstenite::tungstenite::protocol::{CloseFrame, Role, WebSocketConfig};

use crate::Limits;
use crate::connection::{Connection, Hello};

pub const APP: Hello<'static> = Hello { client_id: "client-1", app_version: "pistudiodesktop/test" };

/// The room of the pipe in each direction: more than the largest message, so that a write is never
/// stopped by the pipe unless a test makes it small.
const PIPE_BYTES: usize = 40 * 1024 * 1024;

/// How long a test waits (on the paused clock) for something that must happen.
pub const PATIENCE: Duration = Duration::from_secs(600);

/// The three features the engine needs.
pub const FEATURES: [&str; 3] = ["fileDownloadRanges", "fileTransferAck", "agentStreamsMode"];

/// The client's end of the pipe, for `Connection::open`.
pub type ClientSocket = WebSocketStream<DuplexStream>;

/// A WebSocket pair over a pipe of `room` bytes each way: the client's, which refuses a message above
/// the limit as the dial's does, and the daemon's.
pub async fn pair_with_room(limits: &Limits, room: usize) -> (ClientSocket, Peer) {
    let (client, daemon) = duplex(room);
    let config = WebSocketConfig::default().max_message_size(Some(limits.max_message_bytes)).max_frame_size(Some(limits.max_message_bytes));
    let client = WebSocketStream::from_raw_socket(client, Role::Client, Some(config)).await;
    let daemon = WebSocketStream::from_raw_socket(daemon, Role::Server, None).await;
    (client, Peer { ws: daemon })
}

pub async fn pair(limits: &Limits) -> (ClientSocket, Peer) {
    pair_with_room(limits, PIPE_BYTES).await
}

/// The daemon's end of the pipe, driven by the test itself.
pub struct Peer {
    ws: WebSocketStream<DuplexStream>,
}

impl Peer {
    pub async fn send(&mut self, message: Message) {
        self.ws.send(message).await.expect("the pipe takes the frame");
    }

    /// Sends a frame; false when the pipe is gone.
    pub async fn try_send(&mut self, message: Message) -> bool {
        self.ws.send(message).await.is_ok()
    }

    pub async fn next(&mut self) -> Option<Message> {
        match self.ws.next().await {
            Some(Ok(message)) => Some(message),
            Some(Err(_)) | None => None,
        }
    }

    /// The next text frame, parsed.
    pub async fn text(&mut self) -> Value {
        match self.next().await {
            Some(Message::Text(text)) => serde_json::from_str(text.as_str()).expect("the client sends JSON"),
            other => panic!("expected a text frame, got {other:?}"),
        }
    }

    /// Reads `hello` and answers with `server_info` listing `features`.
    pub async fn accept_with(&mut self, features: &[&str]) -> Value {
        let hello = self.text().await;
        assert_eq!(hello["type"], "hello");
        self.send(Message::text(server_info(features).to_string())).await;
        hello
    }

    pub async fn accept(&mut self) -> Value {
        self.accept_with(&FEATURES).await
    }
}

/// What the daemon task does with a frame.
#[derive(Clone, Copy)]
pub struct Script {
    /// Answers every `ping` with a `pong` at once.
    pub answer_pings: bool,
}

pub const ANSWERING: Script = Script { answer_pings: true };
pub const SILENT: Script = Script { answer_pings: false };

enum Command {
    Send(Message),
    /// Drops the pipe: the client's reads end with no close frame.
    Vanish,
}

/// A frame the daemon read, and when (on the paused clock, from the daemon's start).
#[derive(Debug)]
pub struct Seen {
    pub at: Duration,
    pub message: Message,
}

impl Seen {
    pub fn json(&self) -> Value {
        match &self.message {
            Message::Text(text) => serde_json::from_str(text.as_str()).expect("the client sends JSON"),
            other => panic!("expected a text frame, got {other:?}"),
        }
    }

    pub fn kind(&self) -> String {
        match &self.message {
            Message::Text(text) => {
                serde_json::from_str::<Value>(text.as_str()).ok().and_then(|frame| frame["type"].as_str().map(str::to_owned)).unwrap_or_default()
            }
            Message::Binary(_) => "binary".to_owned(),
            Message::Close(_) => "close".to_owned(),
            Message::Ping(_) | Message::Pong(_) => "control".to_owned(),
            Message::Frame(_) => "frame".to_owned(),
        }
    }
}

/// A daemon that reads in a task of its own, tells the test what it read, and sends what the test
/// tells it to.
pub struct Daemon {
    commands: mpsc::UnboundedSender<Command>,
    seen: mpsc::UnboundedReceiver<Seen>,
    pub start: Instant,
}

impl Daemon {
    pub fn spawn(mut peer: Peer, script: Script) -> Self {
        let (commands, mut commands_rx) = mpsc::unbounded_channel();
        let (seen_tx, seen) = mpsc::unbounded_channel();
        let start = Instant::now();
        tokio::spawn(async move {
            loop {
                tokio::select! {
                    command = commands_rx.recv() => match command {
                        Some(Command::Send(message)) => {
                            if peer.ws.send(message).await.is_err() {
                                break;
                            }
                        }
                        Some(Command::Vanish) | None => break,
                    },
                    message = peer.ws.next() => match message {
                        Some(Ok(message)) => {
                            let seen = Seen { at: start.elapsed(), message };
                            if script.answer_pings
                                && let Some(pong) = pong_for(&seen)
                            {
                                let _ = peer.ws.send(pong).await;
                            }
                            let _ = seen_tx.send(seen);
                        }
                        Some(Err(_)) | None => break,
                    },
                }
            }
        });
        Self { commands, seen, start }
    }

    pub fn send(&self, message: Message) {
        let _ = self.commands.send(Command::Send(message));
    }

    pub fn send_json(&self, frame: &Value) {
        self.send(Message::text(frame.to_string()));
    }

    pub fn send_binary(&self, frame: Vec<u8>) {
        self.send(Message::binary(frame));
    }

    pub fn close(&self, code: u16) {
        self.send(Message::Close(Some(CloseFrame { code: CloseCode::from(code), reason: "".into() })));
    }

    pub fn vanish(&self) {
        let _ = self.commands.send(Command::Vanish);
    }

    /// The next frame the daemon read, within the test's patience; `None` when the pipe ended.
    pub async fn next(&mut self) -> Option<Seen> {
        timeout(PATIENCE, self.seen.recv()).await.expect("the daemon read nothing within the patience")
    }

    /// The next frame, which must be a text frame of `kind`.
    pub async fn next_of(&mut self, kind: &str) -> Seen {
        let seen = self.next().await.unwrap_or_else(|| panic!("the pipe ended while waiting for a `{kind}`"));
        assert_eq!(seen.kind(), kind, "{seen:?}");
        seen
    }

    /// Answers the next request, which must be an upload's, as accepted on `stream`.
    pub async fn accept_upload(&mut self, stream: u8) {
        let id = request_id(&self.request().await);
        self.send_json(&upload_accepted(&id, stream));
    }

    /// Everything the daemon has read so far and nobody took.
    pub fn drain(&mut self) -> Vec<Seen> {
        let mut all = Vec::new();
        while let Ok(seen) = self.seen.try_recv() {
            all.push(seen);
        }
        all
    }

    /// The next `session` message the daemon read: a request. Pings and control frames are skipped.
    pub async fn request(&mut self) -> Value {
        loop {
            let seen = self.next().await.expect("the pipe ended while waiting for a request");
            match seen.kind().as_str() {
                "ping" | "control" => {}
                "session" => return seen.json()["message"].clone(),
                other => panic!("expected a request, got `{other}`: {seen:?}"),
            }
        }
    }
}

fn pong_for(seen: &Seen) -> Option<Message> {
    if seen.kind() != "ping" {
        return None;
    }
    let ping = seen.json();
    Some(Message::text(
        json!({ "type": "pong", "requestId": ping["requestId"], "clientSentAt": ping["clientSentAt"], "serverReceivedAt": 1, "serverSentAt": 2 }).to_string(),
    ))
}

/// Opens a connection over a pipe with a daemon that answers the handshake.
pub async fn connect_with(limits: Limits, script: Script) -> (Arc<Connection>, Daemon) {
    let (socket, mut peer) = pair(&limits).await;
    let (opened, _) = tokio::join!(Connection::open(socket, &APP, limits), peer.accept());
    let connection = opened.expect("the handshake succeeds");
    let daemon = Daemon::spawn(peer, script);
    (Arc::new(connection), daemon)
}

pub async fn connect(script: Script) -> (Arc<Connection>, Daemon) {
    connect_with(Limits::default(), script).await
}

// ---- frames ----

pub fn server_info(features: &[&str]) -> Value {
    let features: serde_json::Map<String, Value> = features.iter().map(|name| ((*name).to_owned(), json!(true))).collect();
    json!({ "type": "status", "payload": { "status": "server_info", "serverId": "stand-in", "capabilities": {}, "features": features } })
}

/// A `session` message that answers a request.
pub fn answer(request_id: &str, kind: &str, fields: &Value) -> Value {
    let mut message = json!({ "type": kind, "requestId": request_id });
    if let (Some(message), Some(fields)) = (message.as_object_mut(), fields.as_object()) {
        message.extend(fields.clone());
    }
    json!({ "type": "session", "message": message })
}

pub fn upload_accepted(request_id: &str, stream: u8) -> Value {
    answer(request_id, "file_upload_response", &json!({ "ok": true, "stream": stream }))
}

pub fn rpc_error(request_id: &str, code: &str, message: &str) -> Value {
    json!({ "type": "session", "message": { "type": "rpc_error", "requestId": request_id, "code": code, "message": message } })
}

pub fn upload_complete(transfer_id: &str, stream: u8, ok: bool, bytes_written: u64) -> Value {
    json!({ "type": "session", "message": { "type": "file_upload_complete", "transferId": transfer_id, "stream": stream, "ok": ok, "bytesWritten": bytes_written } })
}

/// A request as the client sent it, for a test that answers it.
pub fn request_id(request: &Value) -> String {
    request["requestId"].as_str().expect("a request has a requestId").to_owned()
}

/// A download's `Begin`, as the daemon sends it.
pub fn begin(stream: u8, total: u64) -> Vec<u8> {
    let mut frame = vec![0x10, stream];
    frame.extend(json!({ "transferId": "d-1", "fileName": "f", "totalBytes": total, "mtimeMs": 7, "offset": 0, "length": total }).to_string().as_bytes());
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

/// The paused clock moves in whole milliseconds, so a deadline is met up to one millisecond late.
#[track_caller]
pub fn assert_about(actual: Duration, expected: Duration) {
    assert!(actual >= expected && actual < expected + Duration::from_millis(5), "{actual:?} is not about {expected:?}");
}
