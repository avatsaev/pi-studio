//! The text frames the daemon sends, read no further than the engine needs.
//!
//! [`Inbound::parse`] sorts a frame by its `type`. A frame the engine awaits keeps what the engine
//! reads from it; any other frame is [`Inbound::Other`] with its `type` and nothing more.
//! Whatever the daemon sends is hostile: a number that is not a whole number from 0 to 2^53 − 1, a
//! missing field or a field of the wrong kind is an [`Error::Protocol`], not a panic.

use serde_json::Value;

use super::fields::{self, Fields, broken};
use crate::{Error, limits::MAX_MESSAGE_BYTES};

/// A text frame from the daemon.
#[derive(Debug, Clone, PartialEq)]
pub enum Inbound {
    /// The `status` frame with `payload.status: "server_info"`: the answer to `hello`.
    ServerInfo(ServerInfo),
    /// A `session` message with a `requestId`, other than `rpc_error`: an answer to a request, or
    /// something the engine did not ask for.
    Reply(Reply),
    /// An `rpc_error`: the daemon refused a request.
    RpcError(RpcError),
    /// A `file_upload_complete` push: the end of an upload.
    UploadComplete(UploadComplete),
    /// The daemon asks whether the engine is there; the engine answers with a `pong`.
    Ping(Ping),
    /// The answer to the engine's `ping`.
    Pong {
        /// The `requestId` of the `ping`.
        request_id: String,
    },
    /// Any other frame, by its `type` (a `session` message's own `type`).
    Other {
        /// The `type` of the frame.
        kind: String,
    },
}

/// The feature flags of `server_info` that the engine needs. A flag the daemon does not list is
/// `false`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ServerInfo {
    /// `fileDownloadRanges`: ranged, guarded downloads and their cancel.
    pub file_download_ranges: bool,
    /// `fileTransferAck`: the `file_upload_complete` push.
    pub file_transfer_ack: bool,
    /// `agentStreamsMode`: `hello`'s `agentStreams: "none"`.
    pub agent_streams_mode: bool,
}

impl ServerInfo {
    /// Fails with the first feature the engine needs and the daemon does not have.
    pub fn require_features(self) -> Result<(), Error> {
        let missing = if !self.file_download_ranges {
            "fileDownloadRanges"
        } else if !self.file_transfer_ack {
            "fileTransferAck"
        } else if !self.agent_streams_mode {
            "agentStreamsMode"
        } else {
            return Ok(());
        };
        Err(Error::UnsupportedDaemon { missing })
    }
}

/// A `session` message that answers a request: its `type`, its `requestId`, and every field of it.
#[derive(Debug, Clone, PartialEq)]
pub struct Reply {
    /// The request this answers.
    pub request_id: String,
    /// The message's `type`.
    pub kind: String,
    /// The whole message object, `type` and `requestId` included.
    pub fields: serde_json::Map<String, Value>,
}

/// An `rpc_error`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RpcError {
    /// The request it answers, when the daemon names one.
    pub request_id: Option<String>,
    /// `unknown_message_type` or `handler_error`; the daemon may add more.
    pub code: String,
    /// The daemon's words.
    pub message: String,
}

/// A `file_upload_complete`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UploadComplete {
    /// The `transferId` the upload was opened with.
    pub transfer_id: String,
    /// The stream the upload used.
    pub stream: u8,
    /// Whether the file is now on the daemon's disk.
    pub ok: bool,
    /// The bytes the daemon wrote.
    pub bytes_written: u64,
    /// Why it failed; present only when `ok` is false.
    pub error: Option<String>,
}

/// The daemon's `ping`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Ping {
    /// The id the `pong` must carry.
    pub request_id: String,
    /// The `clientSentAt` the `pong` repeats, when the `ping` has one.
    pub client_sent_at: Option<u64>,
}

/// The answer to a `file_upload_request`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum UploadResponse {
    /// The stream the `Begin`, `Chunk` and `End` frames use.
    Accepted {
        /// The stream.
        stream: u8,
    },
    /// The daemon said no (`missing_fields`, `no_free_stream`, …).
    Refused {
        /// The daemon's reason.
        error: String,
    },
}

/// The answer to a `file_download_request`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DownloadResponse {
    /// The file will follow as binary frames.
    Accepted(DownloadAccepted),
    /// No binary frame follows.
    Refused(DownloadRefused),
}

/// An accepted download. The values are the daemon's claim: the engine checks them (a range inside
/// the file, `length` as many bytes as arrive) before it relies on them.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DownloadAccepted {
    /// The stream the binary frames use.
    pub stream: u8,
    /// The daemon's id for this transfer.
    pub transfer_id: String,
    /// The whole file's size.
    pub total_bytes: u64,
    /// The file's modification time in milliseconds.
    pub mtime_ms: u64,
    /// The first byte that follows.
    pub offset: u64,
    /// The bytes that follow.
    pub length: u64,
}

/// A refused download.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DownloadRefused {
    /// `not_found`, `changed`, `range_not_satisfiable`, `no_free_stream`, … (the daemon may add more).
    pub error: String,
    /// The stream the daemon had in mind, when it names one.
    pub stream: Option<u8>,
    /// With `changed`: the file's current size.
    pub total_bytes: Option<u64>,
    /// With `changed`: the file's current modification time.
    pub mtime_ms: Option<u64>,
}

/// The answer to a `file_download_cancel_request`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CancelResponse {
    /// True when a download was running and has been stopped.
    pub ok: bool,
    /// `not_found` when none was running.
    pub error: Option<String>,
}

impl Inbound {
    /// Reads one text frame. A frame longer than the socket's message limit, or one that is not a
    /// JSON object with a string `type`, is an error.
    pub fn parse(text: &str) -> Result<Self, Error> {
        if text.len() > MAX_MESSAGE_BYTES {
            return Err(broken("a text frame is longer than the message limit"));
        }
        let Ok(Value::Object(mut frame)) = serde_json::from_str::<Value>(text) else {
            return Err(broken("a text frame is not a JSON object"));
        };
        match fields::string(&frame, "type")?.as_str() {
            "status" => Self::status(&frame),
            "ping" => Ok(Self::Ping(Ping { request_id: fields::string(&frame, "requestId")?, client_sent_at: fields::optional_size(&frame, "clientSentAt")? })),
            "pong" => Ok(Self::Pong { request_id: fields::string(&frame, "requestId")? }),
            "session" => match frame.remove("message") {
                Some(Value::Object(message)) => Self::session_message(message),
                _ => Err(broken("a `session` frame has no `message` object")),
            },
            other => Ok(Self::Other { kind: other.to_owned() }),
        }
    }

    fn status(frame: &Fields) -> Result<Self, Error> {
        let Some(Value::Object(payload)) = frame.get("payload") else {
            return Ok(Self::Other { kind: "status".to_owned() });
        };
        if payload.get("status").and_then(Value::as_str) != Some("server_info") {
            return Ok(Self::Other { kind: "status".to_owned() });
        }
        let features = match payload.get("features") {
            None | Some(Value::Null) => None,
            Some(Value::Object(features)) => Some(features),
            Some(_) => return Err(broken("`features` of the `server_info` is not an object")),
        };
        let flag = |key: &str| features.and_then(|features| features.get(key)).and_then(Value::as_bool).unwrap_or(false);
        Ok(Self::ServerInfo(ServerInfo {
            file_download_ranges: flag("fileDownloadRanges"),
            file_transfer_ack: flag("fileTransferAck"),
            agent_streams_mode: flag("agentStreamsMode"),
        }))
    }

    fn session_message(message: Fields) -> Result<Self, Error> {
        let kind = fields::string(&message, "type")?;
        match kind.as_str() {
            "rpc_error" => Ok(Self::RpcError(RpcError {
                request_id: fields::optional_string(&message, "requestId")?,
                code: fields::string(&message, "code")?,
                message: fields::string(&message, "message")?,
            })),
            "file_upload_complete" => Ok(Self::UploadComplete(UploadComplete {
                transfer_id: fields::string(&message, "transferId")?,
                stream: fields::stream(&message, "stream")?,
                ok: fields::boolean(&message, "ok")?,
                bytes_written: fields::size(&message, "bytesWritten")?,
                error: fields::optional_string(&message, "error")?,
            })),
            _ => match message.get("requestId") {
                Some(Value::String(request_id)) => Ok(Self::Reply(Reply { request_id: request_id.clone(), kind, fields: message })),
                _ => Ok(Self::Other { kind }),
            },
        }
    }
}

impl Reply {
    fn expect_kind(&self, kind: &str) -> Result<(), Error> {
        if self.kind == kind { Ok(()) } else { Err(broken(format!("an answer of the wrong kind: expected `{kind}`"))) }
    }

    /// Reads a `file_upload_response`.
    pub fn upload_response(&self) -> Result<UploadResponse, Error> {
        self.expect_kind("file_upload_response")?;
        if fields::boolean(&self.fields, "ok")? {
            Ok(UploadResponse::Accepted { stream: fields::stream(&self.fields, "stream")? })
        } else {
            Ok(UploadResponse::Refused { error: fields::string(&self.fields, "error")? })
        }
    }

    /// Reads a `file_download_response`.
    pub fn download_response(&self) -> Result<DownloadResponse, Error> {
        self.expect_kind("file_download_response")?;
        let fields = &self.fields;
        if fields::boolean(fields, "ok")? {
            Ok(DownloadResponse::Accepted(DownloadAccepted {
                stream: fields::stream(fields, "stream")?,
                transfer_id: fields::string(fields, "transferId")?,
                total_bytes: fields::size(fields, "totalBytes")?,
                mtime_ms: fields::size(fields, "mtimeMs")?,
                offset: fields::size(fields, "offset")?,
                length: fields::size(fields, "length")?,
            }))
        } else {
            Ok(DownloadResponse::Refused(DownloadRefused {
                error: fields::string(fields, "error")?,
                stream: fields::optional_stream(fields, "stream")?,
                total_bytes: fields::optional_size(fields, "totalBytes")?,
                mtime_ms: fields::optional_size(fields, "mtimeMs")?,
            }))
        }
    }

    /// Reads a `file_download_cancel_response`.
    pub fn cancel_response(&self) -> Result<CancelResponse, Error> {
        self.expect_kind("file_download_cancel_response")?;
        Ok(CancelResponse { ok: fields::boolean(&self.fields, "ok")?, error: fields::optional_string(&self.fields, "error")? })
    }
}
