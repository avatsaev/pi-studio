//! What a test can ask the stand-in daemon to do wrong.
//!
//! A fault is queued with `StandInDaemon::script` and used once, by the first connection that
//! reaches it: a connection fault when its [`After`] is reached, an answer or transfer fault when
//! the request it names comes in. Counters are per connection and start at its upgrade.

/// Which way a frame travels.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Direction {
    /// From the client to the daemon.
    FromClient,
    /// From the daemon to the client.
    ToClient,
}

/// When a connection fault fires.
///
/// "Frames" are the file-transfer (binary) frames of the direction and "bytes" the file bytes of
/// their `Chunk`s; "text frames" are the JSON frames (`hello` counts as the first from the client).
/// A fault fires after the frame that reaches the count has been handled: the daemon has answered
/// it. The one exception is bytes to the client, which are cut exactly: the `Chunk` that would
/// pass the count is sent short, so that the client has received exactly that many file bytes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum After {
    /// At once, before the daemon has read anything.
    Start,
    /// After this many binary frames.
    Frames(Direction, u64),
    /// After this many file bytes.
    Bytes(Direction, u64),
    /// After this many text frames.
    TextFrames(Direction, u64),
}

/// A request that the daemon can refuse or fail.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Request {
    /// `file_upload_request`.
    Upload,
    /// `file_download_request`.
    Download,
    /// `file_download_cancel_request`.
    Cancel,
}

/// A frame the daemon can leave unanswered.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Asked {
    /// The `hello`: no `status` follows.
    Hello,
    /// A `ping`: no `pong` follows.
    Ping,
    /// A `file_upload_request`: ignored whole, no stream is taken.
    Upload,
    /// A `file_download_request`: ignored whole, no stream follows.
    Download,
    /// A `file_download_cancel_request`: ignored whole, the download goes on.
    Cancel,
}

/// A frame that is sent where it does not belong.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Disorder {
    /// A one-byte `Chunk` before the `Begin`.
    ChunkBeforeBegin,
    /// An `End` right after the `Begin`, before any `Chunk`.
    EndBeforeChunks,
    /// A one-byte `Chunk` after the `End`.
    ChunkAfterEnd,
    /// A one-byte `Chunk` on the next stream, which is not open, after the `Begin`.
    ChunkOnOtherStream,
}

/// How the next download's frames go wrong, after the daemon answered `ok: true`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StreamFault {
    /// An `Error` frame with this message as the first frame, no `Begin` (the real daemon does
    /// this when a cancel arrives between its answer and its first frame).
    ErrorFirst(String),
    /// One extra frame in the wrong place.
    OutOfOrder(Disorder),
    /// A `Chunk` of this many bytes right after the `Begin`, which a client with a smaller message
    /// limit cannot read.
    Oversized(usize),
    /// This many bytes more than the announced `length`, then the `End`.
    ExtraBytes(u64),
    /// The first `bytes` of the range, then an `Error` frame with this message and no `End` (the
    /// real daemon sends `read_failed`, or `changed` when the file shrank).
    ErrorAfter {
        /// File bytes sent before the `Error`.
        bytes: u64,
        /// The `Error` frame's text.
        message: String,
    },
}

/// One misbehaviour. Queue it with `StandInDaemon::script`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Fault {
    /// Send a WebSocket close frame with this code and end the connection.
    Close {
        /// When.
        after: After,
        /// The close code.
        code: u16,
    },
    /// Drop the TCP connection with a reset (no close frame).
    Reset {
        /// When.
        after: After,
    },
    /// Stop reading the socket and keep it open; what the daemon still has to send, it sends.
    StopReading {
        /// When.
        after: After,
    },
    /// Read as usual and send nothing more: every frame the daemon would send is dropped.
    StopAnswering {
        /// When.
        after: After,
    },
    /// Answer the next request of this kind with `ok: false` and this error (`no_free_stream`,
    /// `not_found`, `changed`, …), and do nothing else with it.
    Refuse {
        /// The request.
        request: Request,
        /// The `error` of the answer.
        error: String,
    },
    /// Answer the next request of this kind with an `rpc_error`.
    RpcError {
        /// The request.
        request: Request,
        /// The error `code` (`handler_error`, …).
        code: String,
        /// The error `message`.
        message: String,
    },
    /// Leave the next frame of this kind unanswered; the connection goes on.
    Silence {
        /// The frame.
        request: Asked,
    },
    /// The next upload that ends is not kept, and `file_upload_complete` says `ok: false` with this
    /// error (`rename_failed (EACCES)`, …).
    UploadFails {
        /// The `error` of the push.
        error: String,
    },
    /// The next `file_upload_complete` says this many bytes were written, whatever the truth.
    WrongBytesWritten {
        /// The `bytesWritten` of the push.
        reported: u64,
    },
    /// The next accepted download's frames go wrong this way.
    DownloadStream(StreamFault),
}

impl Fault {
    /// The no-free-stream refusal of a request.
    #[must_use]
    pub fn no_free_stream(request: Request) -> Self {
        Self::Refuse { request, error: "no_free_stream".to_owned() }
    }

    /// When a connection fault fires; `None` for a fault that waits for a request.
    pub(super) fn after(&self) -> Option<After> {
        match self {
            Self::Close { after, .. } | Self::Reset { after } | Self::StopReading { after } | Self::StopAnswering { after } => Some(*after),
            _ => None,
        }
    }
}
