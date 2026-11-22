//! A save over the bulk connection: a file on the daemon in, a [`Sink`] out.
//!
//! [`save`] runs the wire flow of spec § 5 on an open [`Connection`]:
//!
//! 1. `file_download_request { path, stream }` with a stream from the connection's own pool (0 to
//!    255), registered before the request is sent, because the daemon answers first and streams right
//!    after. A resume adds `offset` (the bytes in the sink) and `ifUnchanged { size, mtimeMs }` (the
//!    file as the first answer described it). There is no `length`: the daemon sends to the end of
//!    the file (S12).
//! 2. The answer, then `Begin`, `Chunk`s and `End` or `Error`. An `Error` may be the first and only
//!    frame of a stream.
//! 3. Each `Chunk` is written to the sink before the next frame is taken, and the frame is held until
//!    it is written, so the connection does not read the socket while more than the download hold
//!    (1 MiB, [`Limits::download_hold_bytes`]) of what the daemon sent is waiting for the sink. A slow
//!    disk slows the daemon, and the other transfers of the connection with it; memory does not grow
//!    with the file.
//!
//! The save is done when `End` came and exactly the bytes the answer announced were written; then the
//! sink is finished. More bytes than announced, a `Chunk` before `Begin` and an `End` before all the
//! bytes are [`SaveError::Protocol`]. The answer is checked before anything is written: the stream
//! is the one asked for, the range starts at the sink's end and runs to the end of the file, a
//! resume got the file it guarded, and `Begin` repeats the answer.
//!
//! # Outcomes
//!
//! `Ok(`[`Saved`]`)`, or a [`SaveError`]: [`Changed`](SaveError::Changed) (the daemon says the file is
//! not the one the save began with), [`DaemonRefused`](SaveError::DaemonRefused) (with its reason),
//! [`Disk`](SaveError::Disk) (the sink failed, with the system's reason), [`Cancelled`](SaveError::Cancelled),
//! [`Protocol`](SaveError::Protocol), and [`ConnectionLost`](SaveError::ConnectionLost), its own
//! outcome: the connection ended or the daemon did not answer. Every error but the last leaves the
//! sink discarded. The last leaves it as it is, with the bytes written so far, and carries the file's
//! [`Version`] when the daemon had answered, so that a later save resumes into the same sink.
//!
//! # Stopping a save
//!
//! Whenever a save ends before the daemon's terminal frame (a cancel, a failed write, a daemon that
//! broke the protocol) it sends `file_download_cancel_request { stream }` and **keeps the stream id
//! reserved until the daemon's last frame, a refusal, or the connection's end**, as the daemon
//! may still send frames on it: a stream id that is used again too early would receive them.
//! [`save`] returns once that is so, or after the answer time (30 s) without it; in that case the
//! reservation is kept by a task of its own that takes and drops the frames until the daemon's
//! terminal frame or the end of the connection. The cancel may race the daemon's answer to the request
//! in both orders (the cancel's `{ ok: true }` before the request's answer, or after it) and a
//! refusal or an `Error` frame may be all that follows; the stream is free after either.
//!
//! # Cancelling from outside
//!
//! The caller passes a future, `cancel`, and the save is cancelled when it completes, with the same
//! convention as [`upload`](crate::upload). The engine passes its transfer's token (`token.cancelled()`);
//! a test passes a channel's receiver. A future that never completes (`std::future::pending()`)
//! makes the save uncancellable. A cancel that is already complete sends nothing. A cancel during a
//! write drops the write: the sink is then only discarded. A cancel during [`Sink::finish`] waits for
//! it, and the save is complete. Dropping the save's own future also ends it, with no cancel sent and
//! the stream id released at once: use `cancel`.
//!
//! # Progress
//!
//! `progress` is called once when the daemon has accepted (`done` is the sink's bytes, `total` the
//! file's size, so that the page can show the total before the first byte), then after each write
//! with the bytes the sink holds. A resume therefore starts from the bytes already written, not from 0.

mod answer;
mod error;
mod receive;
mod settle;
mod sink;

#[cfg(any(test, feature = "testing"))]
mod memory;

#[cfg(test)]
mod tests;

use std::pin::pin;

use futures_util::FutureExt;

use self::answer::Asking;
pub use self::error::SaveError;
#[cfg(any(test, feature = "testing"))]
pub use self::memory::MemorySink;
use self::receive::Receive;
use self::settle::{Asked, Reserved, hold, settle};
pub use self::sink::Sink;
use crate::connection::Connection;
use crate::error::Error;
use crate::limits::Limits;
use crate::wire::inbound::Reply;
use crate::wire::outbound::{self, DownloadRequest, IfUnchanged};

/// A file on the daemon as its first answer described it: what a resume guards with (`ifUnchanged`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Version {
    /// The file's size.
    pub total_bytes: u64,
    /// The file's modification time in milliseconds.
    pub mtime_ms: u64,
}

/// What to save.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Request<'a> {
    /// The file on the daemon's machine.
    pub path: &'a str,
    /// `None` for a first attempt: the sink must be empty. `Some` resumes: the request names the
    /// sink's [`written`](Sink::written) as its offset and this file as its guard, and the daemon
    /// answers `changed` if the file is no longer that one.
    pub resume: Option<Version>,
}

/// A save that completed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Saved {
    /// The file as the daemon's answer described it.
    pub version: Version,
    /// The bytes this call wrote: the file from the offset it began at.
    pub bytes: u64,
}

/// How far a save is: the bytes the sink holds, of the file's size.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Progress {
    /// The bytes written, those of earlier attempts included.
    pub done: u64,
    /// The file's size.
    pub total: u64,
}

/// Saves the file `request` names into `sink` over `connection`. See the module's documentation
/// for the flow, the outcomes and the ways to stop it.
///
/// `limits.answer_wait` bounds how long a stop waits for the daemon to let go of the stream.
///
/// # Errors
/// A [`SaveError`]. A save that returned any but [`SaveError::ConnectionLost`] has discarded the sink.
pub async fn save<S, P, C>(connection: &Connection, request: Request<'_>, sink: &mut S, progress: P, cancel: C, limits: &Limits) -> Result<Saved, SaveError>
where
    S: Sink,
    P: FnMut(Progress) + Send,
    C: Future<Output = ()> + Send,
{
    let mut cancel = pin!(cancel);
    let offset = sink.written();
    let early = if request.resume.is_none() && offset != 0 {
        Some(SaveError::Internal("a save without a resume point needs an empty sink"))
    } else if cancel.as_mut().now_or_never().is_some() {
        // Nothing was sent: there is nothing to stop on the daemon's side.
        Some(SaveError::Cancelled)
    } else {
        None
    };
    if let Some(error) = early {
        return Err(abandon(sink, error).await);
    }
    // The stream is registered before the request is sent: the daemon answers first and streams right after.
    let mut download = match connection.download() {
        Ok(download) => download,
        Err(error) => return Err(abandon(sink, SaveError::from_connection(error, request.resume)).await),
    };
    let asking = Asking { stream: download.stream(), offset, guard: request.resume };
    let mut asked = pin!(ask(connection, request, asking));
    let stop = match Receive::new(sink, progress, asking).run(&mut download, asked.as_mut(), &mut cancel).await {
        Ok(saved) => return Ok(saved),
        Err(stop) => stop,
    };
    let error = abandon(sink, stop.error).await;
    if stop.asked != Asked::Settled && settle(connection, &mut download, asked, stop.asked, limits).await == Reserved::Held {
        hold(download);
    }
    Err(error)
}

/// The request: `offset` and `ifUnchanged` only when the save resumes, and never a `length`.
async fn ask(connection: &Connection, request: Request<'_>, asking: Asking) -> Result<Reply, Error> {
    connection
        .request(|id| {
            outbound::download_request(&DownloadRequest {
                request_id: id,
                path: request.path,
                stream: Some(asking.stream),
                offset: asking.guard.map(|_| asking.offset),
                length: None,
                if_unchanged: asking.guard.map(|guard| IfUnchanged { size: guard.total_bytes, mtime_ms: guard.mtime_ms }),
            })
        })
        .await
}

/// The sink after a save that did not complete: discarded, unless the connection was lost, which
/// leaves it to resume into. Returns `error`, so that a stop is one expression.
async fn abandon<S: Sink>(sink: &mut S, error: SaveError) -> SaveError {
    if !matches!(error, SaveError::ConnectionLost { .. }) {
        sink.discard().await;
    }
    error
}
