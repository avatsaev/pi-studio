//! Why a channel refused a frame. Every variant but [`ChannelError::NotReady`], [`ChannelError::AlreadyReady`]
//! and [`ChannelError::Closed`] (a caller's mistake) is a `channel_error` close of the socket
//! (`relay-protocol.md` § 4): the channel is then closed for good and delivers nothing more.

use thiserror::Error;

/// A refusal of the encrypted channel.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Error)]
pub enum ChannelError {
    /// The operating system gave no random bytes for the key pair.
    #[error("the system gave no random bytes for the channel key")]
    Random,
    /// The first frame from the daemon is not `0x01`, a 15-byte salt and a box.
    #[error("the ready frame is malformed")]
    MalformedReady,
    /// A box shorter than a 1-byte record plus the 16-byte tag.
    #[error("the box is too short")]
    BoxTooShort,
    /// The box does not open with the expected counter: wrong key, modified, replayed, dropped,
    /// reordered or sent back to its sender.
    #[error("the box did not open")]
    BoxDidNotOpen,
    /// The first box is not exactly a `ready` record.
    #[error("the first box is not a ready record")]
    NotAReadyRecord,
    /// A box that opened to nothing.
    #[error("the record is empty")]
    EmptyRecord,
    /// A `ready` record after the channel is open.
    #[error("a ready record after the channel opened")]
    UnexpectedReady,
    /// A record kind that is not `ready`, text or binary.
    #[error("the record kind is unknown")]
    UnknownKind,
    /// A text record that is not UTF-8.
    #[error("the text record is not UTF-8")]
    NotUtf8,
    /// A counter in one direction has been used up: the connection must close before it wraps.
    #[error("the counter limit is reached")]
    CounterLimit,
    /// Sealing failed inside the cipher.
    #[error("the record could not be sealed")]
    SealFailed,
    /// A message was sealed or opened before the `ready` box opened.
    #[error("the channel is not open yet")]
    NotReady,
    /// The `ready` frame was given twice.
    #[error("the channel is already open")]
    AlreadyReady,
    /// The channel failed earlier and takes nothing more.
    #[error("the channel is closed")]
    Closed,
}
