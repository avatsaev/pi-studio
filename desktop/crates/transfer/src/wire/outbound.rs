//! The text frames the engine sends.
//!
//! Each function returns the frame's JSON text, ready for a WebSocket text message. A request is
//! `{ "type": "session", "message": { "type", "requestId", … } }`; the answer carries the same
//! `requestId`.

use serde_json::{Value, json};

/// The protocol version in `hello`.
const PROTOCOL_VERSION: u8 = 1;

/// A text frame as its JSON text. A [`Value`] always serializes, so this has no error to give.
fn text(frame: &Value) -> String {
    frame.to_string()
}

fn session(message: Value) -> String {
    text(&json!({ "type": "session", "message": message }))
}

/// The handshake. The engine's connection moves files only, so it asks for no `agent_stream`
/// frame (`agentStreams: "none"`) and offers no `capabilities`.
pub fn hello(client_id: &str, app_version: &str) -> String {
    text(&json!({
        "type": "hello",
        "clientId": client_id,
        "clientType": "browser",
        "platform": "desktop",
        "agentStreams": "none",
        "protocolVersion": PROTOCOL_VERSION,
        "appVersion": app_version,
    }))
}

/// Opens an upload to `path` on the daemon. `transfer_id` ties the `Begin` frame and the
/// `file_upload_complete` push to this attempt. `ack: true` asks for that push.
pub fn upload_request(request_id: &str, path: &str, transfer_id: &str) -> String {
    session(json!({
        "type": "file_upload_request",
        "requestId": request_id,
        "path": path,
        "transferId": transfer_id,
        "ack": true,
    }))
}

/// The file's size and modification time as the daemon first reported them. A resume sends them back
/// so that the daemon refuses (`changed`) when the file is no longer the one that was started.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct IfUnchanged {
    /// The file's `totalBytes`.
    pub size: u64,
    /// The file's `mtimeMs`.
    pub mtime_ms: u64,
}

/// A `file_download_request`. The engine always names a `stream` and never a `length` (the daemon
/// sends to the end of the file); the daemon accepts both being left out or given.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DownloadRequest<'a> {
    /// Names the answer.
    pub request_id: &'a str,
    /// The file on the daemon's machine.
    pub path: &'a str,
    /// The stream the daemon sends the file on; `None` lets the daemon pick.
    pub stream: Option<u8>,
    /// The first byte to send; `None` starts at 0.
    pub offset: Option<u64>,
    /// The bytes to send; `None` sends to the end of the file.
    pub length: Option<u64>,
    /// The guard of a resume.
    pub if_unchanged: Option<IfUnchanged>,
}

/// Asks the daemon to send a file (or a range of it) as binary frames on a stream.
pub fn download_request(request: &DownloadRequest<'_>) -> String {
    let mut message = json!({
        "type": "file_download_request",
        "requestId": request.request_id,
        "path": request.path,
    });
    if let Some(stream) = request.stream {
        message["stream"] = json!(stream);
    }
    if let Some(offset) = request.offset {
        message["offset"] = json!(offset);
    }
    if let Some(length) = request.length {
        message["length"] = json!(length);
    }
    if let Some(guard) = request.if_unchanged {
        message["ifUnchanged"] = json!({ "size": guard.size, "mtimeMs": guard.mtime_ms });
    }
    session(message)
}

/// Stops the download on `stream`. The daemon answers, and when one was running it sends an `Error`
/// frame `cancelled` on that stream.
pub fn download_cancel_request(request_id: &str, stream: u8) -> String {
    session(json!({
        "type": "file_download_cancel_request",
        "requestId": request_id,
        "stream": stream,
    }))
}

/// A liveness `ping`; `client_sent_at_ms` is epoch milliseconds.
pub fn ping(request_id: &str, client_sent_at_ms: u64) -> String {
    text(&json!({ "type": "ping", "requestId": request_id, "clientSentAt": client_sent_at_ms }))
}

/// The answer to the daemon's `ping`. `client_sent_at_ms` is the `clientSentAt` the daemon's ping
/// carried, if any; the other two are epoch milliseconds.
pub fn pong(request_id: &str, client_sent_at_ms: Option<u64>, received_at_ms: u64, sent_at_ms: u64) -> String {
    let mut frame = json!({
        "type": "pong",
        "requestId": request_id,
        "serverReceivedAt": received_at_ms,
        "serverSentAt": sent_at_ms,
    });
    if let Some(sent_at) = client_sent_at_ms {
        frame["clientSentAt"] = json!(sent_at);
    }
    text(&frame)
}
