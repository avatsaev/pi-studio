//! The file-transfer binary frames: `[opcode][stream][payload]`.
//!
//! Opcodes: `Begin` 0x10, `Chunk` 0x11, `End` 0x12, `Error` 0x13. An upload sends all four kinds
//! and a download receives them, so the encoders build what an upload sends (`Begin` with only its
//! `transferId`) and [`decode`] reads what a download receives (`Begin` with its whole metadata).

use serde_json::{Value, json};

use super::fields::{self, broken};
use crate::{Error, limits::MAX_MESSAGE_BYTES};

const BEGIN: u8 = 0x10;
const CHUNK: u8 = 0x11;
const END: u8 = 0x12;
const ERROR: u8 = 0x13;

/// The bytes before the payload: the opcode and the stream.
const HEADER_BYTES: usize = 2;

/// The longest `Begin` payload read. The metadata is a few short strings and numbers; a larger one is
/// not the daemon's, and parsing it would only spend memory.
const MAX_BEGIN_BYTES: usize = 64 * 1024;

/// The metadata of a `Begin` frame. Fields the daemon sends that are not listed here are dropped.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BeginMeta {
    /// The id of the transfer.
    pub transfer_id: String,
    /// The file's name.
    pub file_name: Option<String>,
    /// The file's media type.
    pub mime_type: Option<String>,
    /// The whole file's size.
    pub total_bytes: Option<u64>,
    /// The file's modification time in milliseconds.
    pub mtime_ms: Option<u64>,
    /// The first byte of the range that follows.
    pub offset: Option<u64>,
    /// The bytes of the range that follows.
    pub length: Option<u64>,
}

/// A file-transfer frame as a download receives it. A `Chunk` borrows its bytes from the frame.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FileFrame<'a> {
    /// The metadata that opens a transfer.
    Begin {
        /// The stream.
        stream: u8,
        /// The metadata.
        meta: BeginMeta,
    },
    /// A piece of the file, in file order.
    Chunk {
        /// The stream.
        stream: u8,
        /// The file's bytes.
        data: &'a [u8],
    },
    /// The transfer is over: `ok` false means it was aborted.
    End {
        /// The stream.
        stream: u8,
        /// Whether the transfer completed.
        ok: bool,
    },
    /// The transfer failed or was cancelled; nothing follows on the stream.
    Error {
        /// The stream.
        stream: u8,
        /// The daemon's words.
        message: String,
    },
}

impl FileFrame<'_> {
    /// The stream the frame is on.
    pub fn stream(&self) -> u8 {
        match self {
            Self::Begin { stream, .. } | Self::Chunk { stream, .. } | Self::End { stream, .. } | Self::Error { stream, .. } => *stream,
        }
    }
}

/// Reads a binary frame. A frame with fewer than two bytes, an opcode other than `0x10`–`0x13`, a
/// frame longer than the message limit, or a `Begin` that is not the expected JSON is an error. An
/// `End` with no payload byte counts as ok, as the SDK reads it.
pub fn decode(frame: &[u8]) -> Result<FileFrame<'_>, Error> {
    if frame.len() > MAX_MESSAGE_BYTES {
        return Err(broken("a binary frame is longer than the message limit"));
    }
    let [opcode, stream, payload @ ..] = frame else {
        return Err(broken("a binary frame is shorter than its header"));
    };
    let stream = *stream;
    match *opcode {
        BEGIN => Ok(FileFrame::Begin { stream, meta: begin_meta(payload)? }),
        CHUNK => Ok(FileFrame::Chunk { stream, data: payload }),
        END => Ok(FileFrame::End { stream, ok: payload.first().is_none_or(|byte| *byte != 0) }),
        ERROR => Ok(FileFrame::Error { stream, message: String::from_utf8_lossy(payload).into_owned() }),
        _ => Err(broken("a binary frame has an unknown opcode")),
    }
}

fn begin_meta(payload: &[u8]) -> Result<BeginMeta, Error> {
    if payload.len() > MAX_BEGIN_BYTES {
        return Err(broken("a `Begin` frame's metadata is too long"));
    }
    let Ok(Value::Object(meta)) = serde_json::from_slice::<Value>(payload) else {
        return Err(broken("a `Begin` frame's metadata is not a JSON object"));
    };
    Ok(BeginMeta {
        transfer_id: fields::string(&meta, "transferId")?,
        file_name: fields::optional_string(&meta, "fileName")?,
        mime_type: fields::optional_string(&meta, "mimeType")?,
        total_bytes: fields::optional_size(&meta, "totalBytes")?,
        mtime_ms: fields::optional_size(&meta, "mtimeMs")?,
        offset: fields::optional_size(&meta, "offset")?,
        length: fields::optional_size(&meta, "length")?,
    })
}

fn framed(opcode: u8, stream: u8, payload: &[u8]) -> Vec<u8> {
    let mut frame = Vec::with_capacity(HEADER_BYTES + payload.len());
    frame.push(opcode);
    frame.push(stream);
    frame.extend_from_slice(payload);
    frame
}

/// The `Begin` an upload opens with: `{ "transferId": … }`.
pub fn encode_begin(stream: u8, transfer_id: &str) -> Vec<u8> {
    framed(BEGIN, stream, json!({ "transferId": transfer_id }).to_string().as_bytes())
}

/// A `Chunk` of an upload. The frame must fit the socket's message limit, or this is an error.
pub fn encode_chunk(stream: u8, data: &[u8]) -> Result<Vec<u8>, Error> {
    if data.len() > MAX_MESSAGE_BYTES - HEADER_BYTES {
        return Err(broken("a chunk does not fit the message limit"));
    }
    Ok(framed(CHUNK, stream, data))
}

/// The `End` of an upload: one payload byte, 1 for completed, 0 for aborted.
pub fn encode_end(stream: u8, ok: bool) -> Vec<u8> {
    framed(END, stream, &[u8::from(ok)])
}

/// The `Error` that aborts an upload: the message is UTF-8 after the header. The engine's messages
/// are `client_aborted` and `client_error`.
pub fn encode_error(stream: u8, message: &str) -> Result<Vec<u8>, Error> {
    if message.len() > MAX_MESSAGE_BYTES - HEADER_BYTES {
        return Err(broken("an error message does not fit the message limit"));
    }
    Ok(framed(ERROR, stream, message.as_bytes()))
}
