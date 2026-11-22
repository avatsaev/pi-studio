//! What a transfer holds on a connection: a download's stream and the frames that come on it, and
//! an upload's wait for its `file_upload_complete`.

use std::ops::Deref;
use std::sync::Arc;

use tokio::sync::{OwnedSemaphorePermit, Semaphore, mpsc, oneshot};
use tokio_tungstenite::tungstenite::Bytes;

use super::shared::{Shared, StreamSlot};
use crate::Error;
use crate::held::Holding;
use crate::limits::Limits;
use crate::wire::binary::BeginMeta;
use crate::wire::inbound::UploadComplete;

/// What a queued frame costs against the hold, besides its bytes: an estimate of its own memory.
/// It bounds the number of frames as well as their bytes, so that a daemon cannot queue a million
/// empty ones.
const FRAME_OVERHEAD: usize = 64;

/// The hold of one download, in the units a frame is charged in. At least 1, so that a hold of zero
/// cannot make a download wait for room that never comes.
pub(super) fn capacity(limits: &Limits) -> usize {
    limits.download_hold_bytes.max(1)
}

/// What a frame is charged: its bytes and [`FRAME_OVERHEAD`], and never more than the whole hold,
/// so that a frame larger than the hold is taken once everything before it has been released.
pub(super) fn charge(capacity: usize, frame_bytes: usize) -> u32 {
    let cost = frame_bytes.saturating_add(FRAME_OVERHEAD).min(capacity);
    u32::try_from(cost).unwrap_or(u32::MAX)
}

/// The bytes of a `Chunk`: a view into the frame the daemon sent, with no copy.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Chunk(Bytes);

impl Chunk {
    pub(super) fn new(bytes: Bytes) -> Self {
        Self(bytes)
    }
}

impl Deref for Chunk {
    type Target = [u8];

    fn deref(&self) -> &[u8] {
        &self.0
    }
}

/// A file-transfer frame of a download, as the daemon sent it. Nothing is checked but the frame's
/// own shape: a `Chunk` before `Begin`, or more bytes than were announced, is for the download to
/// notice.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Frame {
    /// The metadata that opens the transfer.
    Begin(BeginMeta),
    /// A piece of the file, in file order.
    Chunk(Chunk),
    /// The transfer is over: `ok` false means it was aborted.
    End {
        /// Whether the transfer completed.
        ok: bool,
    },
    /// The transfer failed or was cancelled; nothing follows on the stream.
    Error {
        /// The daemon's words.
        message: String,
    },
}

/// A frame and what it costs against the hold. The connection reads the socket again only while
/// less than the hold is outstanding, so the consumer lets a frame go, by dropping the delivery,
/// once it has written it.
#[derive(Debug)]
pub struct Delivery {
    frame: Frame,
    _hold: OwnedSemaphorePermit,
    _holding: Holding,
}

impl Delivery {
    pub(super) fn new(frame: Frame, hold: OwnedSemaphorePermit, holding: Holding) -> Self {
        Self { frame, _hold: hold, _holding: holding }
    }

    /// The frame.
    #[must_use]
    pub fn frame(&self) -> &Frame {
        &self.frame
    }
}

/// A stream the connection routes to this download, and the frames that come on it.
///
/// The connection holds at most the hold ([`Limits::download_hold_bytes`](crate::Limits::download_hold_bytes))
/// plus one frame for the download: it does not read the socket while the consumer has not
/// released the frames it was given. Keep the download until the daemon's last frame on the stream,
/// a refusal, or the end of the connection: the stream id is free again once it is dropped, and a
/// frame the daemon still sends on it then is ignored.
#[derive(Debug)]
pub struct Download {
    stream: u8,
    frames: mpsc::UnboundedReceiver<Delivery>,
    hold: Arc<Semaphore>,
    shared: Arc<Shared>,
}

impl Download {
    pub(super) fn new(shared: &Arc<Shared>) -> Result<Self, Error> {
        let (frames_tx, frames) = mpsc::unbounded_channel();
        let hold = Arc::new(Semaphore::new(capacity(&shared.limits)));
        let stream = shared.register_stream(StreamSlot { frames: frames_tx, hold: Arc::clone(&hold) })?;
        Ok(Self { stream, frames, hold, shared: Arc::clone(shared) })
    }

    /// The stream to ask the daemon to send on.
    #[must_use]
    pub fn stream(&self) -> u8 {
        self.stream
    }

    /// The next frame on the stream, in the order the daemon sent them. When the connection has
    /// ended and every frame has been taken, the reason it ended.
    ///
    /// # Errors
    /// [`Error::Closed`] or the protocol error that ended the connection.
    pub async fn next(&mut self) -> Result<Delivery, Error> {
        match self.frames.recv().await {
            Some(delivery) => Ok(delivery),
            None => Err(self.shared.ended_error()),
        }
    }

    /// The bytes charged against the hold right now.
    #[cfg(test)]
    pub(super) fn held(&self) -> usize {
        capacity(&self.shared.limits) - self.hold.available_permits()
    }
}

impl Drop for Download {
    fn drop(&mut self) {
        // The reader may be waiting for room for a frame of this stream: it must not wait for a consumer that is gone.
        self.hold.close();
        self.shared.release_stream(self.stream);
    }
}

/// The wait for the `file_upload_complete` of one upload.
#[derive(Debug)]
pub struct UploadWait {
    transfer_id: String,
    complete: oneshot::Receiver<Result<UploadComplete, Error>>,
    shared: Arc<Shared>,
}

impl UploadWait {
    pub(super) fn new(shared: &Arc<Shared>, transfer_id: &str) -> Result<Self, Error> {
        let complete = shared.register_upload(transfer_id)?;
        Ok(Self { transfer_id: transfer_id.to_owned(), complete, shared: Arc::clone(shared) })
    }

    /// The `transferId` this waits for.
    #[must_use]
    pub fn transfer_id(&self) -> &str {
        &self.transfer_id
    }

    /// Waits for the daemon's `file_upload_complete` with this `transferId`. It has no time limit of
    /// its own: an upload gets no frame back until it ends, and the connection's liveness decides
    /// whether the daemon is still there.
    ///
    /// # Errors
    /// The reason the connection ended, when it did first.
    pub async fn complete(mut self) -> Result<UploadComplete, Error> {
        match (&mut self.complete).await {
            Ok(result) => result,
            Err(_) => Err(self.shared.ended_error()),
        }
    }
}

impl Drop for UploadWait {
    fn drop(&mut self) {
        self.shared.forget_upload(&self.transfer_id);
    }
}
