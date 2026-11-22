//! Ending a save early without leaving the daemon streaming: a cancel on the wire, and the stream id
//! kept reserved until the daemon has nothing more to send on it.
//!
//! The daemon reserves a download's stream when the request *arrives*, before it opens the file, so a
//! `file_download_cancel_request` sent right after the request is answered `{ ok: true }` before the
//! request is. Then exactly one of two things follows: the request's `{ ok: true }` and an `Error`
//! frame `cancelled` with no `Begin`, or (the open failed) the request's `{ ok: false }` and no
//! frame. A download that is already running answers the cancel `{ ok: true }` and then sends the
//! `Error` frame; one that has finished answers `{ ok: false, error: "not_found" }`.
//!
//! So the stream is free to be used again when any one of these has happened:
//!
//! * a terminal frame (`End` or `Error`) arrived on it;
//! * the request was refused, or the daemon says it has no download there (`not_found`) while it has
//!   not said that it accepted this one;
//! * the connection ended (every stream is then gone).
//!
//! An accepted download always ends with a terminal frame, so a `not_found` after an accepted
//! answer only means that the frame is still on its way: it is awaited.
//!
//! While this waits, the frames of the stream are still taken and dropped: the connection stops
//! reading the socket while a consumer holds too much, and the answers this waits for are behind them.

use std::pin::{Pin, pin};

use tokio::time::timeout;

use super::error::SaveError;
use crate::Limits;
use crate::connection::{Connection, Download, Frame};
use crate::error::Error;
use crate::wire::inbound::{DownloadResponse, Reply};
use crate::wire::outbound;

/// What a save knows of the daemon's answer to its download request, when it stops.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Asked {
    /// Nothing is left on the daemon's side: the request was refused, or a terminal frame arrived,
    /// or the connection ended. No cancel is needed.
    Settled,
    /// The request is still unanswered.
    Pending,
    /// The request was accepted: a terminal frame is still to come.
    Accepted,
    /// The answer is lost (it timed out, or it is not one) or the request failed in a way that does
    /// not say whether the daemon reserved the stream.
    Unknown,
}

/// A save that ended early: why, and what the daemon's stream still needs.
#[derive(Debug)]
pub(super) struct Stop {
    pub error: SaveError,
    pub asked: Asked,
}

impl Stop {
    pub fn new(error: SaveError, asked: Asked) -> Self {
        Self { error, asked }
    }
}

/// Whether the stream may be used again.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Reserved {
    /// The daemon has nothing more to send on it.
    Free,
    /// It may still send: the reservation is kept ([`hold`]).
    Held,
}

fn is_terminal(frame: &Frame) -> bool {
    matches!(frame, Frame::End { .. } | Frame::Error { .. })
}

/// What the wait has learned so far.
struct Waiting {
    asked: Asked,
    /// The daemon answered the cancel `not_found`: it has no download on the stream.
    denied: bool,
}

impl Waiting {
    fn settled(&self) -> bool {
        match self.asked {
            Asked::Settled => true,
            Asked::Accepted => false,
            Asked::Pending | Asked::Unknown => self.denied,
        }
    }

    /// The daemon's answer to the download request, which came after the save stopped.
    fn answered(&mut self, reply: Result<Reply, Error>) -> Option<Reserved> {
        match reply {
            Ok(reply) => {
                self.asked = match reply.download_response() {
                    Ok(DownloadResponse::Refused(_)) => Asked::Settled,
                    Ok(DownloadResponse::Accepted(_)) => Asked::Accepted,
                    Err(_) => Asked::Unknown,
                };
                None
            }
            Err(error) => self.failed(&error, Asked::Unknown),
        }
    }

    /// The daemon's answer to the cancel.
    fn cancelled(&mut self, reply: Result<Reply, Error>) -> Option<Reserved> {
        match reply {
            Ok(reply) => {
                self.denied = reply.cancel_response().is_ok_and(|answer| !answer.ok);
                None
            }
            // A cancel that fails for another reason says nothing: the terminal frame, or the deadline, decides.
            Err(error) => self.failed(&error, self.asked),
        }
    }

    /// An answer that did not come: the connection is over (free), or the answer is lost.
    fn failed(&mut self, error: &Error, otherwise: Asked) -> Option<Reserved> {
        if matches!(error, Error::Closed(_) | Error::Protocol(_)) {
            return Some(Reserved::Free);
        }
        self.asked = otherwise;
        None
    }
}

/// Sends the cancel, and waits until the stream is free to use again, or until the answer time
/// (`limits.answer_wait`) has passed, whichever is first.
///
/// `asked` is the download request's own wait, when it was still pending (`state` is then
/// [`Asked::Pending`]); it is polled no more once it has completed.
pub(super) async fn settle<A>(connection: &Connection, download: &mut Download, asked: Pin<&mut A>, state: Asked, limits: &Limits) -> Reserved
where
    A: Future<Output = Result<Reply, Error>>,
{
    timeout(limits.answer_wait, until_free(connection, download, asked, state)).await.unwrap_or(Reserved::Held)
}

async fn until_free<A>(connection: &Connection, download: &mut Download, mut asked: Pin<&mut A>, state: Asked) -> Reserved
where
    A: Future<Output = Result<Reply, Error>>,
{
    let stream = download.stream();
    let mut cancel = pin!(connection.request(|id| outbound::download_cancel_request(id, stream)));
    let mut cancel_pending = true;
    let mut waiting = Waiting { asked: state, denied: false };
    while !waiting.settled() {
        let outcome = tokio::select! {
            biased;
            reply = asked.as_mut(), if waiting.asked == Asked::Pending => waiting.answered(reply),
            reply = cancel.as_mut(), if cancel_pending => {
                cancel_pending = false;
                waiting.cancelled(reply)
            }
            next = download.next() => match next {
                Ok(delivery) if is_terminal(delivery.frame()) => Some(Reserved::Free),
                Ok(_) => None,
                Err(_) => Some(Reserved::Free),
            },
        };
        if let Some(reserved) = outcome {
            return reserved;
        }
    }
    Reserved::Free
}

/// Keeps `download` registered, and its frames taken, until the daemon's terminal frame or the end
/// of the connection: the stream id is not used again before then. The task ends with either.
pub(super) fn hold(mut download: Download) {
    tokio::spawn(async move {
        while let Ok(delivery) = download.next().await {
            if is_terminal(delivery.frame()) {
                break;
            }
        }
    });
}
