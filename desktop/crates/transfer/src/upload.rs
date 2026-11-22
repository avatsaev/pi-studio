//! An upload over the bulk connection: a source of bytes in, a file on the daemon out.
//!
//! [`upload`] runs the wire flow of spec § 4 on an open [`Connection`]:
//!
//! 1. `file_upload_request { path, transferId, ack: true }`; the daemon answers a stream, or refuses.
//! 2. `Begin`, then `Chunk`s of at most [`CHUNK_BYTES`](crate::limits::CHUNK_BYTES) in file order, then
//!    `End`. **Every frame is awaited**: the next piece is not read from the source until the
//!    previous frame is on the socket, so the upload holds one chunk (and the frame it was copied
//!    into) whatever the size of the file, and a daemon that stops reading stops the source with it.
//! 3. The wait for `file_upload_complete` with this `transferId`. The upload is done only when it says
//!    `ok` and its `bytesWritten` equals the bytes that were sent (S11).
//!
//! # Outcomes
//!
//! `Ok(`[`Uploaded`]`)`, or an [`UploadError`]: the daemon refused (`daemon_refused`), the source could not
//! be read (`source_unreadable`) or gave other bytes than its size at the start (`source_changed`),
//! the byte counts differ (`size_mismatch`), the caller cancelled (`cancelled`), the daemon broke the
//! protocol (`protocol`), or the connection went away ([`UploadError::ConnectionLost`], its own
//! outcome: the engine decides whether to start again).
//!
//! # Stopping an upload
//!
//! From the daemon's answer to the last write of `End`, the daemon holds a stream for the upload and a
//! temporary file. Any stop in that window sends `Error` with `client_aborted` (the caller
//! cancelled) or `client_error` (anything else: an unreadable or changed source, an unexpected
//! fault), so that the daemon discards what it has. The send is best effort and waits at most the
//! close wait of the limits. A lost connection sends nothing: the daemon's session ending does the
//! same. After `End` is written the daemon finishes by itself, so a stop there sends nothing, and a
//! cancel that comes in the very last moment may find the file already complete.
//!
//! A cancel before the daemon's answer to the request sends nothing either (the stream it chose is not
//! known); a daemon that had already chosen one frees it when the connection ends.
//!
//! # Cancelling from outside
//!
//! The caller passes a future, `cancel`, and the upload is cancelled when it completes. The engine
//! passes its transfer's token (`token.cancelled()`); a test passes a channel's receiver. A future that
//! never completes (`std::future::pending()`) makes the upload uncancellable. Dropping the upload's
//! own future also stops it, but sends no `Error`: use `cancel`.
//!
//! # Progress
//!
//! `progress` is called with the total bytes of the file whose `Chunk` frame has been written to the
//! socket, after each one. A restart starts from 0 again: it is another call.
//!
//! The transfer id is the caller's: a new one for each attempt (the daemon matches `Begin` and the
//! `file_upload_complete` push by it, and an attempt that restarts must not be mistaken for the one
//! before it).

mod error;

#[cfg(any(test, feature = "testing"))]
mod memory;

#[cfg(test)]
mod tests;

use std::io;
use std::pin::{Pin, pin};

use tokio::time::timeout;

pub use self::error::UploadError;
#[cfg(any(test, feature = "testing"))]
pub use self::memory::MemorySource;
use crate::Error;
use crate::connection::Connection;
use crate::limits::{CHUNK_BYTES, Limits};
use crate::wire::binary;
use crate::wire::inbound::{UploadComplete, UploadResponse};
use crate::wire::outbound;

/// What an upload reads its bytes from. The app implements it over a local file; a test over memory
/// ([`MemorySource`]).
///
/// An upload reads a source once, from its start. A source that is read again (an upload that
/// restarts) is a new value, made by whoever holds the file.
pub trait UploadSource: Send {
    /// The size of the source when the upload begins, if it is known. A known size is checked: an
    /// upload that reads more or fewer bytes than that is [`UploadError::SourceChanged`].
    fn size(&self) -> Option<u64>;

    /// Reads the next bytes into `buf`, which is never empty, and returns how many: 0 is the end.
    /// A read may be cut short; the upload asks again until its chunk is full or the source ends.
    ///
    /// The future may be dropped before it completes (a cancel); the source is not used again then.
    ///
    /// # Errors
    /// The system's error. Its text is shown to the user (`source_unreadable`), so it must not
    /// carry a local path.
    fn read(&mut self, buf: &mut [u8]) -> impl Future<Output = io::Result<usize>> + Send;
}

/// Where an upload goes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Target<'a> {
    /// The file's path on the daemon's machine.
    pub path: &'a str,
    /// A new id for this attempt.
    pub transfer_id: &'a str,
}

/// An upload that the daemon confirmed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Uploaded {
    /// The bytes sent, which the daemon reported as written.
    pub bytes: u64,
}

/// Uploads `source` to `target` over `connection`. See the module's documentation for the flow,
/// the outcomes and the two ways to stop it.
///
/// `limits.chunk_bytes` (never more than 32 KiB, never less than 1) is the size of a `Chunk`, and
/// `limits.close_wait` bounds the send of the `Error` frame that stops an upload.
///
/// # Errors
/// An [`UploadError`]; nothing is kept on the daemon for an upload that returned one, unless it
/// returned [`UploadError::SizeMismatch`] (the daemon wrote the file, and said another size).
pub async fn upload<S, P, C>(
    connection: &Connection,
    target: Target<'_>,
    source: &mut S,
    mut progress: P,
    cancel: C,
    limits: &Limits,
) -> Result<Uploaded, UploadError>
where
    S: UploadSource,
    P: FnMut(u64) + Send,
    C: Future<Output = ()> + Send,
{
    let mut cancel = pin!(cancel);
    let wait = connection.expect_upload(target.transfer_id)?;
    let stream = open(connection, target, &mut cancel).await?;
    let mut send = Sending { connection, stream, source, progress: &mut progress, cancel: &mut cancel, chunk_bytes: limits.chunk_bytes.clamp(1, CHUNK_BYTES) };
    let sent = match send.run(target.transfer_id).await {
        Ok(sent) => sent,
        Err(error) => {
            abort(connection, stream, &error, limits).await;
            return Err(error);
        }
    };
    let complete = guarded(&mut cancel, wait.complete()).await??;
    confirm(complete, stream, sent)
}

/// Asks the daemon for a stream.
async fn open<C: Future<Output = ()>>(connection: &Connection, target: Target<'_>, cancel: &mut Pin<&mut C>) -> Result<u8, UploadError> {
    let request = connection.request(|id| outbound::upload_request(id, target.path, target.transfer_id));
    match guarded(cancel, request).await??.upload_response()? {
        UploadResponse::Accepted { stream } => Ok(stream),
        UploadResponse::Refused { error } => Err(UploadError::DaemonRefused { reason: error }),
    }
}

/// What `file_upload_complete` says about an upload of `sent` bytes on `stream`.
fn confirm(complete: UploadComplete, stream: u8, sent: u64) -> Result<Uploaded, UploadError> {
    if complete.stream != stream {
        return Err(UploadError::Protocol(Error::Protocol("`file_upload_complete` names another stream".into())));
    }
    if !complete.ok {
        return Err(UploadError::DaemonRefused { reason: complete.error.unwrap_or_else(|| "the write failed".to_owned()) });
    }
    if complete.bytes_written != sent {
        return Err(UploadError::SizeMismatch { sent, reported: complete.bytes_written });
    }
    Ok(Uploaded { bytes: sent })
}

/// Waits for `work`, or for the cancel, whichever is first.
async fn guarded<C: Future<Output = ()>, T>(cancel: &mut Pin<&mut C>, work: impl Future<Output = T>) -> Result<T, UploadError> {
    tokio::select! {
        biased;
        () = cancel.as_mut() => Err(UploadError::Cancelled),
        out = work => Ok(out),
    }
}

/// Tells the daemon to discard an upload that `error` stopped, when it is still open there.
async fn abort(connection: &Connection, stream: u8, error: &UploadError, limits: &Limits) {
    let message = match error {
        UploadError::Cancelled => "client_aborted",
        UploadError::ConnectionLost(_) => return,
        _ => "client_error",
    };
    if let Ok(frame) = binary::encode_error(stream, message) {
        let _ = timeout(limits.close_wait, connection.send_binary(frame)).await;
    }
}

/// The part of an upload that writes the stream: from `Begin` to `End`.
struct Sending<'a, 'c, S, P, C> {
    connection: &'a Connection,
    stream: u8,
    source: &'a mut S,
    progress: &'a mut P,
    cancel: &'a mut Pin<&'c mut C>,
    chunk_bytes: usize,
}

impl<S: UploadSource, P: FnMut(u64), C: Future<Output = ()>> Sending<'_, '_, S, P, C> {
    /// Sends `Begin`, every `Chunk` and `End`; returns the bytes of the file that were sent.
    async fn run(&mut self, transfer_id: &str) -> Result<u64, UploadError> {
        self.send(binary::encode_begin(self.stream, transfer_id)).await?;
        let size = self.source.size();
        let mut buf = vec![0u8; self.chunk_bytes];
        let mut sent: u64 = 0;
        loop {
            let filled =
                guarded(self.cancel, fill(&mut *self.source, &mut buf)).await?.map_err(|error| UploadError::SourceUnreadable { reason: error.to_string() })?;
            sent = self.chunk(&buf, filled, sent, size).await?;
            if filled < buf.len() {
                break;
            }
        }
        if size.is_some_and(|size| size != sent) {
            return Err(UploadError::SourceChanged);
        }
        self.send(binary::encode_end(self.stream, true)).await?;
        Ok(sent)
    }

    /// Sends the first `filled` bytes of `buf` as one `Chunk`; returns the total sent after it.
    async fn chunk(&mut self, buf: &[u8], filled: usize, sent: u64, size: Option<u64>) -> Result<u64, UploadError> {
        let Some(data) = buf.get(..filled).filter(|data| !data.is_empty()) else { return Ok(sent) };
        let total = u64::try_from(filled).ok().and_then(|bytes| sent.checked_add(bytes)).ok_or(UploadError::Internal("the bytes sent do not fit a counter"))?;
        if size.is_some_and(|size| total > size) {
            return Err(UploadError::SourceChanged);
        }
        let frame = binary::encode_chunk(self.stream, data).map_err(|_| UploadError::Internal("a chunk does not fit the message limit"))?;
        self.send(frame).await?;
        (self.progress)(total);
        Ok(total)
    }

    async fn send(&mut self, frame: Vec<u8>) -> Result<(), UploadError> {
        guarded(self.cancel, self.connection.send_binary(frame)).await??;
        Ok(())
    }
}

/// Reads until `buf` is full or the source ends; fewer bytes than `buf` holds means the end.
async fn fill<S: UploadSource>(source: &mut S, buf: &mut [u8]) -> io::Result<usize> {
    let mut filled = 0;
    while let Some(room) = buf.get_mut(filled..).filter(|room| !room.is_empty()) {
        let room_len = room.len();
        let read = source.read(room).await?;
        if read == 0 {
            break;
        }
        if read > room_len {
            return Err(io::Error::new(io::ErrorKind::InvalidData, "the source returned more bytes than it was given"));
        }
        filled += read;
    }
    Ok(filled)
}
