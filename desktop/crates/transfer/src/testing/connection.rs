//! One client's connection to the stand-in daemon: one task that reads the client's frames, writes
//! what the daemon answers and streams, and applies the scripted faults at the points they name.

use std::collections::HashMap;
use std::ops::ControlFlow;
use std::sync::Arc;
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use serde_json::{Map, Value};
use socket2::SockRef;
use tokio::net::TcpStream;
use tokio::sync::{mpsc, watch};
use tokio::time::timeout;
use tokio_tungstenite::WebSocketStream;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::tungstenite::protocol::CloseFrame;
use tokio_tungstenite::tungstenite::protocol::frame::coding::CloseCode;

use super::download::{self, DownloadCtl, Downloads, Plan};
use super::fault::{After, Asked, Direction, Fault, Request, StreamFault};
use super::frames::{self, CHUNK_OPCODE, HEADER_BYTES};
use super::state::Shared;
use crate::wire::binary::{self, FileFrame};

type Flow = ControlFlow<()>;

/// Frames a download task may have queued for the connection's task before it waits.
const QUEUED_FRAMES: usize = 4;

/// How long a close waits for the client's answer before the socket is dropped.
const CLOSE_WAIT: Duration = Duration::from_secs(1);

/// The largest stream id space: ids are one byte.
const SLOT_SPACE: usize = 256;

const FILE_DOWNLOAD_RESPONSE: &str = "file_download_response";
const FILE_UPLOAD_RESPONSE: &str = "file_upload_response";

/// What a connection has carried, for the faults that fire after a count.
#[derive(Default)]
struct Counters {
    frames: [u64; 2],
    bytes: [u64; 2],
    texts: [u64; 2],
}

fn index(direction: Direction) -> usize {
    match direction {
        Direction::FromClient => 0,
        Direction::ToClient => 1,
    }
}

impl Counters {
    fn reached(&self, after: After) -> bool {
        match after {
            After::Start => true,
            After::Frames(direction, n) => self.frames[index(direction)] >= n,
            After::Bytes(direction, n) => self.bytes[index(direction)] >= n,
            After::TextFrames(direction, n) => self.texts[index(direction)] >= n,
        }
    }
}

/// An upload the daemon has accepted and not finished.
struct Upload {
    transfer_id: String,
    path: String,
    ack: bool,
    /// `None` until a `Begin` with the right `transferId` arrived; then what the `Chunk`s brought (nothing
    /// when the daemon does not keep uploads).
    data: Option<Vec<u8>>,
    /// The file bytes that arrived in `Chunk`s after the `Begin`.
    received: u64,
}

/// How an upload ended.
enum Ending {
    /// The client's `End`.
    End,
    /// The client's `Error` frame, with its message.
    Aborted(String),
}

/// A request the daemon was told to refuse, fail or ignore.
enum Intercept {
    Silence,
    Refuse(String),
    RpcError(String, String),
}

pub(super) struct Connection {
    ws: WebSocketStream<TcpStream>,
    shared: Arc<Shared>,
    frames_tx: mpsc::Sender<Vec<u8>>,
    frames_rx: mpsc::Receiver<Vec<u8>>,
    counters: Counters,
    reading: bool,
    /// Changes when a test calls `StandInDaemon::resume_reading`.
    resumed: watch::Receiver<u64>,
    answering: bool,
    handshaken: bool,
    uploads: HashMap<u8, Upload>,
    upload_cursor: usize,
    downloads: Arc<Downloads>,
    download_cursor: usize,
    download_seq: u64,
}

impl Drop for Connection {
    /// The streams of a connection that ended are free: the daemon's count of streams in use forgets its
    /// uploads and its downloads, including a download whose task never started because a fault ended the
    /// connection as the answer went out.
    fn drop(&mut self) {
        let open = self.uploads.len();
        self.shared.with(|state| state.reserved = state.reserved.saturating_sub(open));
        self.downloads.clear();
    }
}

impl Connection {
    pub fn new(ws: WebSocketStream<TcpStream>, shared: Arc<Shared>) -> Self {
        let (frames_tx, frames_rx) = mpsc::channel(QUEUED_FRAMES);
        Self {
            ws,
            frames_tx,
            frames_rx,
            counters: Counters::default(),
            reading: true,
            resumed: shared.resume.subscribe(),
            answering: true,
            handshaken: false,
            uploads: HashMap::new(),
            upload_cursor: 1,
            downloads: Arc::new(Downloads::new(Arc::clone(&shared))),
            download_cursor: 1,
            download_seq: 0,
            shared,
        }
    }

    /// Serves the connection until it ends, by the client, by a fault or by an error.
    pub async fn run(mut self) {
        if self.apply_faults().await.is_break() {
            return;
        }
        loop {
            let flow = tokio::select! {
                message = self.ws.next(), if self.reading => match message {
                    Some(Ok(message)) => self.on_message(message).await,
                    _ => Flow::Break(()),
                },
                frame = self.frames_rx.recv() => match frame {
                    Some(frame) => self.send_binary(frame).await,
                    None => Flow::Break(()),
                },
                Ok(()) = self.resumed.changed(), if !self.reading => {
                    self.reading = true;
                    Flow::Continue(())
                }
            };
            if flow.is_break() {
                return;
            }
        }
    }

    // ---- writing ----

    async fn write(&mut self, message: Message) -> Flow {
        if self.ws.send(message).await.is_ok() { Flow::Continue(()) } else { Flow::Break(()) }
    }

    async fn send_text(&mut self, text: String) -> Flow {
        if !self.answering {
            return Flow::Continue(());
        }
        self.counters.texts[index(Direction::ToClient)] += 1;
        self.write(Message::text(text)).await?;
        self.apply_faults().await
    }

    async fn reply(&mut self, message: Value, request_id: Option<&str>) -> Flow {
        self.send_text(frames::session(message, request_id)).await
    }

    async fn send_binary(&mut self, mut frame: Vec<u8>) -> Flow {
        if !self.answering {
            return Flow::Continue(());
        }
        if frame.first() == Some(&CHUNK_OPCODE) {
            // A fault that cuts the bytes to the client at a count sends the last `Chunk` short.
            let carried = self.counters.bytes[index(Direction::ToClient)];
            if let Some(budget) = self.byte_budget().map(|limit| limit.saturating_sub(carried)) {
                frame.truncate(HEADER_BYTES + usize::try_from(budget).unwrap_or(usize::MAX));
            }
            self.counters.bytes[index(Direction::ToClient)] += frame.len().saturating_sub(HEADER_BYTES) as u64;
        }
        self.counters.frames[index(Direction::ToClient)] += 1;
        self.write(Message::binary(frame)).await?;
        self.apply_faults().await
    }

    /// The smallest count a queued fault waits for in file bytes to the client.
    fn byte_budget(&self) -> Option<u64> {
        self.shared.with(|state| {
            state
                .faults
                .iter()
                .filter_map(|fault| match fault.after() {
                    Some(After::Bytes(Direction::ToClient, n)) => Some(n),
                    _ => None,
                })
                .min()
        })
    }

    async fn close(&mut self, code: u16, reason: &str) {
        let frame = CloseFrame { code: CloseCode::from(code), reason: reason.into() };
        let ws = &mut self.ws;
        // Wait for the client's close so that the frame is read, not lost to a reset.
        let _ = timeout(CLOSE_WAIT, async {
            let _ = ws.close(Some(frame)).await;
            while let Some(Ok(_)) = ws.next().await {}
        })
        .await;
    }

    /// Ends the connection with a reset: the socket lingers for no time, so that dropping it sends
    /// an RST and no close frame.
    fn reset(&self) {
        let _ = SockRef::from(self.ws.get_ref()).set_linger(Some(Duration::ZERO));
    }

    /// Applies every queued connection fault whose count has been reached.
    async fn apply_faults(&mut self) -> Flow {
        loop {
            let counters = &self.counters;
            let due = self.shared.with(|state| state.take_fault(|fault| fault.after().is_some_and(|after| counters.reached(after))));
            match due {
                None => return Flow::Continue(()),
                Some(Fault::Close { code, .. }) => {
                    self.close(code, "").await;
                    return Flow::Break(());
                }
                Some(Fault::Reset { .. }) => {
                    self.reset();
                    return Flow::Break(());
                }
                Some(Fault::StopReading { .. }) => {
                    self.reading = false;
                    // Only a `resume_reading` from now on starts it again.
                    drop(self.resumed.borrow_and_update());
                }
                Some(Fault::StopAnswering { .. }) => self.answering = false,
                Some(_) => {}
            }
        }
    }

    // ---- reading ----

    async fn on_message(&mut self, message: Message) -> Flow {
        match message {
            Message::Text(text) => {
                self.counters.texts[index(Direction::FromClient)] += 1;
                self.on_text(text.as_str()).await?;
            }
            Message::Binary(bytes) => {
                if !self.handshaken {
                    self.close(1008, "expected hello").await;
                    return Flow::Break(());
                }
                self.counters.frames[index(Direction::FromClient)] += 1;
                if bytes.first() == Some(&CHUNK_OPCODE) {
                    self.counters.bytes[index(Direction::FromClient)] += bytes.len().saturating_sub(HEADER_BYTES) as u64;
                }
                self.on_binary(&bytes).await?;
            }
            Message::Close(frame) => {
                let code = frame.map(|frame| u16::from(frame.code));
                self.shared.with(|state| state.client_closes.push(code));
                return Flow::Break(());
            }
            _ => {}
        }
        self.apply_faults().await
    }

    async fn on_text(&mut self, text: &str) -> Flow {
        if !self.handshaken {
            return self.on_hello(text).await;
        }
        let Ok(Value::Object(frame)) = serde_json::from_str::<Value>(text) else { return Flow::Continue(()) };
        match frame.get("type").and_then(Value::as_str) {
            Some("ping") => self.on_ping(&frame).await,
            Some("session") => match frame.get("message") {
                Some(Value::Object(message)) => self.on_request(message).await,
                _ => Flow::Continue(()),
            },
            _ => Flow::Continue(()),
        }
    }

    /// The real daemon closes 1008 when the first frame is not a valid `hello`.
    async fn on_hello(&mut self, text: &str) -> Flow {
        let Ok(parsed) = serde_json::from_str::<Value>(text) else {
            self.close(1008, "invalid hello").await;
            return Flow::Break(());
        };
        let valid = parsed.get("type").and_then(Value::as_str) == Some("hello")
            && parsed.get("clientId").is_some_and(Value::is_string)
            && parsed.get("clientType").is_some_and(Value::is_string)
            && parsed.get("protocolVersion").is_some_and(Value::is_number);
        if !valid {
            self.close(1008, "first frame must be hello").await;
            return Flow::Break(());
        }
        self.handshaken = true;
        let silenced = self.shared.with(|state| {
            state.hellos.push(parsed);
            state.take_fault(|fault| matches!(fault, Fault::Silence { request: Asked::Hello })).is_some()
        });
        if silenced {
            return Flow::Continue(());
        }
        self.send_text(frames::status(self.shared.config.features)).await
    }

    async fn on_ping(&mut self, frame: &Map<String, Value>) -> Flow {
        let silenced = self.shared.with(|state| state.take_fault(|fault| matches!(fault, Fault::Silence { request: Asked::Ping })).is_some());
        let Some(request_id) = frame.get("requestId").and_then(Value::as_str) else { return Flow::Continue(()) };
        if silenced {
            return Flow::Continue(());
        }
        let now_ms = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |elapsed| elapsed.as_millis() as u64);
        self.send_text(frames::pong(request_id, frame.get("clientSentAt"), now_ms)).await
    }

    // ---- requests ----

    async fn on_request(&mut self, message: &Map<String, Value>) -> Flow {
        let kind = message.get("type").and_then(Value::as_str).unwrap_or_default();
        let request_id = message.get("requestId").and_then(Value::as_str);
        let (request, asked, response_kind) = match kind {
            "file_upload_request" => (Request::Upload, Asked::Upload, FILE_UPLOAD_RESPONSE),
            "file_download_request" => (Request::Download, Asked::Download, FILE_DOWNLOAD_RESPONSE),
            "file_download_cancel_request" => (Request::Cancel, Asked::Cancel, "file_download_cancel_response"),
            _ => {
                return match request_id {
                    Some(id) => self.send_text(frames::rpc_error(id, "unknown_message_type", &format!("no handler for {kind}"))).await,
                    None => Flow::Continue(()),
                };
            }
        };
        if let Some(intercept) = self.intercept(request, asked) {
            return match intercept {
                Intercept::Silence => Flow::Continue(()),
                Intercept::Refuse(error) => self.reply(frames::refusal(response_kind, &error, None, None), request_id).await,
                Intercept::RpcError(code, text) => match request_id {
                    Some(id) => self.send_text(frames::rpc_error(id, &code, &text)).await,
                    None => Flow::Continue(()),
                },
            };
        }
        match request {
            Request::Upload => self.on_upload_request(message, request_id).await,
            Request::Download => self.on_download_request(message, request_id).await,
            Request::Cancel => self.on_cancel_request(message, request_id).await,
        }
    }

    fn intercept(&self, request: Request, asked: Asked) -> Option<Intercept> {
        let fault = self.shared.with(|state| {
            state.take_fault(|fault| match fault {
                Fault::Silence { request } => *request == asked,
                Fault::Refuse { request: wanted, .. } | Fault::RpcError { request: wanted, .. } => *wanted == request,
                _ => false,
            })
        })?;
        match fault {
            Fault::Refuse { error, .. } => Some(Intercept::Refuse(error)),
            Fault::RpcError { code, message, .. } => Some(Intercept::RpcError(code, message)),
            _ => Some(Intercept::Silence),
        }
    }

    async fn on_upload_request(&mut self, message: &Map<String, Value>, request_id: Option<&str>) -> Flow {
        let text = |key: &str| message.get(key).and_then(Value::as_str).filter(|value| !value.is_empty());
        let (Some(path), Some(transfer_id)) = (text("path"), text("transferId")) else {
            return self.reply(frames::refusal(FILE_UPLOAD_RESPONSE, "missing_fields", None, None), request_id).await;
        };
        let slots = self.shared.config.stream_slots.min(SLOT_SPACE);
        let Some(stream) = next_free(slots, self.upload_cursor, |stream| self.uploads.contains_key(&stream)) else {
            return self.reply(frames::refusal(FILE_UPLOAD_RESPONSE, "no_free_stream", None, None), request_id).await;
        };
        self.upload_cursor = (usize::from(stream) + 1) % slots;
        let ack = message.get("ack") == Some(&Value::Bool(true));
        self.uploads.insert(stream, Upload { transfer_id: transfer_id.to_owned(), path: path.to_owned(), ack, data: None, received: 0 });
        self.shared.with(|state| state.reserved += 1);
        self.reply(frames::upload_accepted(stream), request_id).await
    }

    async fn on_cancel_request(&mut self, message: &Map<String, Value>, request_id: Option<&str>) -> Flow {
        let stream = message.get("stream").and_then(Value::as_u64).and_then(|stream| u8::try_from(stream).ok());
        let Some(ctl) = stream.and_then(|stream| self.downloads.get(stream)) else {
            return self.reply(frames::cancel_response(false), request_id).await;
        };
        // The answer goes first and the `Error` frame follows from the download, as in the real daemon.
        self.reply(frames::cancel_response(true), request_id).await?;
        ctl.cancel();
        Flow::Continue(())
    }

    async fn on_download_request(&mut self, message: &Map<String, Value>, request_id: Option<&str>) -> Flow {
        match self.open_download(message) {
            Err(refusal) => self.reply(refusal, request_id).await,
            Ok((plan, ctl)) => {
                self.reply(frames::download_accepted(plan.stream, &plan.meta()), request_id).await?;
                tokio::spawn(download::run(plan, self.frames_tx.clone(), ctl, Arc::clone(&self.downloads)));
                Flow::Continue(())
            }
        }
    }

    /// The real daemon's checks, in its order, and the reservation of the stream.
    fn open_download(&mut self, message: &Map<String, Value>) -> Result<(Plan, Arc<DownloadCtl>), Value> {
        let refuse = |error: &str, stream: Option<u8>, current: Option<(u64, u64)>| frames::refusal(FILE_DOWNLOAD_RESPONSE, error, stream, current);
        self.shared.with(|state| state.download_requests.push(Value::Object(message.clone())));
        let Some(path) = message.get("path").and_then(Value::as_str).filter(|path| !path.is_empty()) else {
            return Err(refuse("missing_path", None, None));
        };
        let requested = match message.get("stream") {
            None => None,
            Some(value) => match value.as_u64().and_then(|stream| u8::try_from(stream).ok()) {
                Some(stream) => Some(stream),
                None => return Err(refuse("invalid_stream", None, None)),
            },
        };
        let (Ok(offset), Ok(requested_length)) = (count(message, "offset", 0), count(message, "length", 1)) else {
            return Err(refuse("invalid_range", None, None));
        };
        let slots = self.shared.config.stream_slots.min(SLOT_SPACE);
        let stream = match requested {
            Some(stream) => stream,
            None => match next_free(slots, self.download_cursor, |stream| self.downloads.is_active(stream)) {
                Some(stream) => stream,
                None => return Err(refuse("no_free_stream", None, None)),
            },
        };
        if self.downloads.is_active(stream) {
            return Err(refuse("stream_in_use", Some(stream), None));
        }
        if requested.is_none() {
            self.download_cursor = (usize::from(stream) + 1) % slots;
        }

        let Some(file) = self.shared.with(|state| state.files.get(path).cloned()) else {
            return Err(refuse("not_found", Some(stream), None));
        };
        let size = file.content.len();
        let offset = offset.unwrap_or(0);
        if offset > size {
            return Err(refuse("range_not_satisfiable", Some(stream), None));
        }
        if let Some(guard) = message.get("ifUnchanged")
            && !matches_file(guard, size, file.mtime_ms)
        {
            return Err(refuse("changed", Some(stream), Some((size, file.mtime_ms))));
        }
        let available = size - offset;
        self.download_seq += 1;
        let plan = Plan {
            stream,
            transfer_id: format!("dl-{stream}-{}", self.download_seq),
            file_name: path.rsplit('/').next().unwrap_or(path).to_owned(),
            mime_type: frames::mime_for(path),
            total_bytes: size,
            mtime_ms: file.mtime_ms,
            offset,
            length: requested_length.unwrap_or(available).min(available),
            content: file.content,
            fault: self.take_stream_fault(),
            chunk_bytes: self.shared.config.chunk_bytes,
            chunk_delay: self.shared.config.chunk_delay,
        };
        let ctl = self.downloads.reserve(stream);
        Ok((plan, ctl))
    }

    fn take_stream_fault(&self) -> Option<StreamFault> {
        match self.shared.with(|state| state.take_fault(|fault| matches!(fault, Fault::DownloadStream(_)))) {
            Some(Fault::DownloadStream(fault)) => Some(fault),
            _ => None,
        }
    }

    // ---- uploads ----

    /// The client's file-transfer frames: only an open upload's, and only its `transferId`'s `Begin`.
    async fn on_binary(&mut self, bytes: &[u8]) -> Flow {
        let Ok(frame) = binary::decode(bytes) else { return Flow::Continue(()) };
        let stream = frame.stream();
        let Some(upload) = self.uploads.get_mut(&stream) else { return Flow::Continue(()) };
        match frame {
            FileFrame::Begin { meta, .. } => {
                if meta.transfer_id == upload.transfer_id {
                    upload.data.get_or_insert_with(Vec::new);
                }
                Flow::Continue(())
            }
            FileFrame::Chunk { data, .. } => {
                if let Some(held) = &mut upload.data {
                    upload.received = upload.received.saturating_add(data.len() as u64);
                    if self.shared.config.store_uploads {
                        held.extend_from_slice(data);
                    }
                }
                Flow::Continue(())
            }
            FileFrame::End { .. } => self.finish_upload(stream, Ending::End).await,
            FileFrame::Error { message, .. } => self.finish_upload(stream, Ending::Aborted(message)).await,
        }
    }

    /// Ends an upload: the file is kept only when the client's `End` arrived after its `Begin`.
    /// Like the real daemon, the `End`'s `ok` byte is not read.
    async fn finish_upload(&mut self, stream: u8, ending: Ending) -> Flow {
        let Some(upload) = self.uploads.remove(&stream) else { return Flow::Continue(()) };
        self.shared.with(|state| state.reserved = state.reserved.saturating_sub(1));
        let received = upload.received;
        let (data, mut error) = match (ending, upload.data) {
            (Ending::End, Some(data)) => (Some(data), None),
            (Ending::End, None) => (None, Some("no_begin".to_owned())),
            (Ending::Aborted(message), _) => (None, Some(if message.is_empty() { "client_error".to_owned() } else { message })),
        };
        let (failure, reported) = self.shared.with(|state| {
            let failure = data.as_ref().and_then(|_| state.take_fault(|fault| matches!(fault, Fault::UploadFails { .. })));
            let reported = state.take_fault(|fault| matches!(fault, Fault::WrongBytesWritten { .. }));
            (failure, reported)
        });
        if let Some(Fault::UploadFails { error: text }) = failure {
            error = Some(text);
        }
        let reported = if let Some(Fault::WrongBytesWritten { reported }) = reported { reported } else { received };
        let keep = self.shared.config.store_uploads;
        self.shared.with(|state| {
            if let (Some(data), None) = (data, &error)
                && keep
            {
                state.store(&upload.path, data);
            }
            state.uploads.push(super::state::UploadRecord {
                transfer_id: upload.transfer_id.clone(),
                path: upload.path.clone(),
                bytes_received: received,
                error: error.clone(),
            });
        });
        if upload.ack {
            return self.send_text(frames::upload_complete(&upload.transfer_id, stream, reported, error.as_deref())).await;
        }
        Flow::Continue(())
    }
}

/// The lowest free stream at or after `cursor`, wrapping, among `slots`; `None` when all are in use.
fn next_free(slots: usize, cursor: usize, in_use: impl Fn(u8) -> bool) -> Option<u8> {
    (0..slots).map(|step| (cursor + step) % slots).filter_map(|slot| u8::try_from(slot).ok()).find(|slot| !in_use(*slot))
}

/// A count in a request: absent is `Ok(None)`, a whole number from `min` to 2^53 − 1 is itself,
/// anything else is an error.
fn count(message: &Map<String, Value>, key: &str, min: u64) -> Result<Option<u64>, ()> {
    const MAX_SAFE: u64 = (1 << 53) - 1;
    match message.get(key) {
        None => Ok(None),
        Some(value) => value.as_u64().filter(|n| (min..=MAX_SAFE).contains(n)).map(Some).ok_or(()),
    }
}

/// `ifUnchanged` equals the file as it is now; anything but `{ size, mtimeMs }` never does.
fn matches_file(guard: &Value, size: u64, mtime_ms: u64) -> bool {
    guard.get("size").and_then(Value::as_u64) == Some(size) && guard.get("mtimeMs").and_then(Value::as_u64) == Some(mtime_ms)
}
