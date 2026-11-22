//! The frames the stand-in sends, built independently of `wire` so that a test of `wire` against
//! the stand-in is a test of two writers against the same fixtures.

use serde_json::{Value, json};

use super::server::Features;

const BEGIN: u8 = 0x10;
const CHUNK: u8 = 0x11;
const END: u8 = 0x12;
const ERROR: u8 = 0x13;

/// The bytes before a binary frame's payload.
pub(super) const HEADER_BYTES: usize = 2;

/// The opcode byte of a `Chunk`.
pub(super) const CHUNK_OPCODE: u8 = CHUNK;

/// What a download's `Begin` says about the file and the range.
pub(super) struct Meta<'a> {
    pub transfer_id: &'a str,
    pub file_name: &'a str,
    pub mime_type: &'a str,
    pub total_bytes: u64,
    pub mtime_ms: u64,
    pub offset: u64,
    pub length: u64,
}

fn framed(opcode: u8, stream: u8, payload: &[u8]) -> Vec<u8> {
    let mut frame = Vec::with_capacity(HEADER_BYTES + payload.len());
    frame.push(opcode);
    frame.push(stream);
    frame.extend_from_slice(payload);
    frame
}

pub(super) fn begin(stream: u8, meta: &Meta<'_>) -> Vec<u8> {
    let payload = json!({
        "transferId": meta.transfer_id,
        "fileName": meta.file_name,
        "mimeType": meta.mime_type,
        "totalBytes": meta.total_bytes,
        "mtimeMs": meta.mtime_ms,
        "offset": meta.offset,
        "length": meta.length,
    });
    framed(BEGIN, stream, payload.to_string().as_bytes())
}

pub(super) fn chunk(stream: u8, data: &[u8]) -> Vec<u8> {
    framed(CHUNK, stream, data)
}

pub(super) fn end(stream: u8) -> Vec<u8> {
    framed(END, stream, &[1])
}

pub(super) fn error(stream: u8, message: &str) -> Vec<u8> {
    framed(ERROR, stream, message.as_bytes())
}

/// The `status` frame that answers `hello`. A feature that is off is left out, as an older daemon
/// leaves it out.
pub(super) fn status(features: Features) -> String {
    let mut flags = json!({
        "extensionUi": true,
        "thinkingLevels": true,
        "forkTimelineSync": true,
        "compactionEvents": true,
        "agentTodos": true,
    });
    for (key, on) in [
        ("fileDownloadRanges", features.file_download_ranges),
        ("fileTransferAck", features.file_transfer_ack),
        ("agentStreamsMode", features.agent_streams_mode),
    ] {
        if on {
            flags[key] = json!(true);
        }
    }
    json!({
        "type": "status",
        "payload": {
            "status": "server_info",
            "serverId": "00000000-0000-4000-8000-0000000000aa",
            "hostname": "stand-in-daemon",
            "version": "0.0.0-stand-in",
            "homeDir": "/home/stand-in",
            "capabilities": {},
            "features": flags,
        },
    })
    .to_string()
}

/// A `session` frame around `message`, with the `requestId` of the request it answers when there is one.
pub(super) fn session(mut message: Value, request_id: Option<&str>) -> String {
    if let Some(id) = request_id {
        message["requestId"] = json!(id);
    }
    json!({ "type": "session", "message": message }).to_string()
}

pub(super) fn pong(request_id: &str, client_sent_at: Option<&Value>, now_ms: u64) -> String {
    let mut frame = json!({
        "type": "pong",
        "requestId": request_id,
        "serverReceivedAt": now_ms,
        "serverSentAt": now_ms,
    });
    if let Some(sent_at) = client_sent_at {
        frame["clientSentAt"] = sent_at.clone();
    }
    frame.to_string()
}

/// A `file_*_response` that says no.
pub(super) fn refusal(kind: &str, error: &str, stream: Option<u8>, current: Option<(u64, u64)>) -> Value {
    let mut message = json!({ "type": kind, "ok": false, "error": error });
    if let Some(stream) = stream {
        message["stream"] = json!(stream);
    }
    if let Some((total_bytes, mtime_ms)) = current {
        message["totalBytes"] = json!(total_bytes);
        message["mtimeMs"] = json!(mtime_ms);
    }
    message
}

pub(super) fn upload_accepted(stream: u8) -> Value {
    json!({ "type": "file_upload_response", "ok": true, "stream": stream })
}

pub(super) fn download_accepted(stream: u8, meta: &Meta<'_>) -> Value {
    json!({
        "type": "file_download_response",
        "ok": true,
        "stream": stream,
        "transferId": meta.transfer_id,
        "totalBytes": meta.total_bytes,
        "mtimeMs": meta.mtime_ms,
        "offset": meta.offset,
        "length": meta.length,
    })
}

pub(super) fn cancel_response(accepted: bool) -> Value {
    if accepted {
        json!({ "type": "file_download_cancel_response", "ok": true })
    } else {
        json!({ "type": "file_download_cancel_response", "ok": false, "error": "not_found" })
    }
}

pub(super) fn rpc_error(request_id: &str, code: &str, message: &str) -> String {
    session(json!({ "type": "rpc_error", "code": code, "message": message }), Some(request_id))
}

pub(super) fn upload_complete(transfer_id: &str, stream: u8, bytes_written: u64, error: Option<&str>) -> String {
    let mut message = json!({
        "type": "file_upload_complete",
        "transferId": transfer_id,
        "stream": stream,
        "ok": error.is_none(),
        "bytesWritten": bytes_written,
    });
    if let Some(error) = error {
        message["error"] = json!(error);
    }
    session(message, None)
}

/// The media type the real daemon would guess; only the few that tests name.
pub(super) fn mime_for(file_name: &str) -> &'static str {
    match file_name.rsplit_once('.').map(|(_, extension)| extension) {
        Some("txt") => "text/plain",
        Some("json") => "application/json",
        Some("png") => "image/png",
        _ => "application/octet-stream",
    }
}
