//! The bulk connection: the engine's own session with the daemon, over a socket [`net::dial`] opened.
//!
//! [`Connection::open`] sends `hello`, waits for `server_info`, requires the three features the engine
//! needs (`unsupported_daemon` otherwise) and starts two tasks, one that reads the socket and one that
//! writes it. What the connection does after that:
//!
//! * **Requests.** [`Connection::request`] sends a `session` frame with a fresh `requestId` and
//!   waits for the answer with that id: the answer is the request's value, an `rpc_error` with its id is
//!   its [`Error::Rpc`], and nothing within the answer time is [`Error::Timeout`] for that request
//!   alone. An answer that comes after that, or that nobody asked for, is dropped.
//! * **Writing.** [`Connection::send_text`] and [`Connection::send_binary`] return when the frame is on
//!   the socket, so a sender that waits for each frame before it queues the next has one frame in
//!   flight, whatever the size of the file. The writer serves pings and pongs first.
//! * **Uploads.** [`Connection::expect_upload`] registers a `transferId` before the request is made,
//!   and the [`UploadWait`] it returns gets the one `file_upload_complete` with that id.
//! * **Downloads.** [`Connection::download`] takes a free stream id, 0 to 255, and returns a
//!   [`Download`] that gets the frames on that stream. The reader takes a frame off the socket only
//!   while the consumer has released enough of the frames it was given (the download hold: 1 MiB
//!   and one frame), so the connection reads no faster than the consumer writes. Time a frame waits
//!   for its consumer is not silence, and the other transfers wait with it.
//! * **Liveness.** After the ping time with no frame of any kind from the daemon, a `ping`; after the
//!   dropped time with none, the connection is over ([`Ended::Silent`]). A `ping` from the daemon is
//!   answered with a `pong`.
//! * **Everything else is ignored:** a text frame that is not awaited, a binary frame that is not
//!   `0x10`–`0x13` or not on a registered stream. A frame that breaks the protocol (a message above
//!   the limit, text that is not UTF-8, a frame `wire` cannot read) ends the connection with
//!   [`Error::Protocol`].
//! * **Ending.** [`Connection::close`] closes with 1000 or 1001 and waits for the daemon's close frame
//!   up to the close wait. However the connection ends, every waiter is told once, with the reason
//!   ([`Error::Closed`] or the protocol error); a download first receives what was already queued
//!   for it. [`Connection::ended`] waits for the end and returns the reason.
//!
//! The connection keeps nothing per transfer but what is in flight: a request's answer slot, an
//! upload's, a download's stream and its hold. Its memory does not grow with a file.
//!
//! All the time here is tokio's: a test pauses the clock and nothing sleeps for real. Closing the
//! idle connection, reconnecting and the queue are the engine's.
//!
//! [`net::dial`]: pistudiodesktop_net::dial

mod download;
mod failure;
mod handshake;
mod reader;
mod shared;
mod writer;

#[cfg(test)]
mod tests;

use std::sync::Arc;

use futures_util::StreamExt;
use pistudiodesktop_net::DaemonSocket;
use tokio::time::timeout;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::tungstenite::protocol::frame::coding::CloseCode;

pub use self::download::{Chunk, Delivery, Download, Frame, UploadWait};
pub use self::handshake::Hello;
use self::shared::{Shared, close_message};
use crate::Limits;
use crate::error::{Ended, Error};
use crate::held::Held;
use crate::wire::inbound::Reply;

/// How the engine closes the connection.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Close {
    /// 1000: the engine is done with the connection (idle, or a switch).
    Normal,
    /// 1001: the app is going away (`boot`, the window closing, exit).
    GoingAway,
}

impl Close {
    fn code(self) -> CloseCode {
        match self {
            Self::Normal => CloseCode::Normal,
            Self::GoingAway => CloseCode::Away,
        }
    }
}

/// An open, handshaken connection to the daemon. Dropping it ends it (1001) without waiting.
#[derive(Debug)]
pub struct Connection {
    shared: Arc<Shared>,
}

/// A request that is waiting for its answer, forgotten when the wait ends, however it ends.
struct Pending<'a> {
    shared: &'a Shared,
    id: String,
}

impl Drop for Pending<'_> {
    fn drop(&mut self) {
        self.shared.forget_request(&self.id);
    }
}

impl Connection {
    /// Says `hello` on `socket`, waits for the daemon's `server_info`, and starts the connection.
    /// In the app `socket` is a [`DaemonSocket`] from
    /// [`net::dial`](pistudiodesktop_net::dial) (or [`dial_over`](pistudiodesktop_net::dial_over)), dialled with `limits.max_message_bytes` as its message
    /// limit; it must refuse a message above that limit as it reads.
    ///
    /// # Errors
    /// * [`Error::UnsupportedDaemon`]: `server_info` lacks `fileDownloadRanges`, `fileTransferAck` or
    ///   `agentStreamsMode`.
    /// * [`Error::Timeout`]: no `server_info` within the answer time.
    /// * [`Error::Protocol`]: the daemon's first frames were broken, or a `status` that is not a `server_info`.
    /// * [`Error::Closed`]: the socket ended first.
    /// * [`Error::Internal`]: the socket does not have the message limit.
    ///
    /// On an error the socket has been closed.
    pub async fn open(socket: DaemonSocket, hello: &Hello<'_>, limits: Limits) -> Result<Self, Error> {
        Self::open_counting(socket, hello, limits, Held::new()).await
    }

    /// [`open`](Self::open), counting the frames of a download that wait to be written against `held`,
    /// which the caller shares with whatever else it counts (the engine's `peakHeld`).
    ///
    /// # Errors
    /// As [`open`](Self::open).
    pub async fn open_counting(mut socket: DaemonSocket, hello: &Hello<'_>, limits: Limits, held: Held) -> Result<Self, Error> {
        if socket.max_message_bytes() > limits.max_message_bytes {
            return Err(Error::Internal("the socket does not refuse a message above the message limit"));
        }
        handshake::run(&mut socket, hello, &limits).await?;
        let (sink, frames) = socket.split();
        let (shared, mail) = Shared::new(limits, held);
        tokio::spawn(writer::run(Arc::clone(&shared), sink, mail, shared.subscribe()));
        tokio::spawn(reader::run(Arc::clone(&shared), frames, shared.subscribe()));
        Ok(Self { shared })
    }

    /// Sends the `session` message `build` makes from a fresh `requestId`, and returns the answer
    /// that carries that id.
    ///
    /// The answer time starts when the frame is on the socket. A request that times out, or whose caller
    /// stops waiting, is forgotten: an answer that arrives later is dropped, and the connection goes on.
    ///
    /// # Errors
    /// [`Error::Rpc`] (an `rpc_error` with this id), [`Error::Timeout`], or the reason the
    /// connection ended.
    pub async fn request(&self, build: impl FnOnce(&str) -> String) -> Result<Reply, Error> {
        let (id, answer) = self.shared.register_request()?;
        let pending = Pending { shared: &self.shared, id };
        self.send_text(build(&pending.id)).await?;
        match timeout(self.shared.limits.answer_wait, answer).await {
            Ok(Ok(answer)) => answer,
            Ok(Err(_)) => Err(self.shared.ended_error()),
            Err(_) => Err(Error::Timeout),
        }
    }

    /// Writes a text frame, and returns when it is on the socket.
    ///
    /// # Errors
    /// [`Error::Internal`] for a frame above the message limit; the reason the connection ended.
    pub async fn send_text(&self, text: String) -> Result<(), Error> {
        self.fit(text.len())?;
        self.shared.send(Message::text(text)).await
    }

    /// Writes a binary frame (an upload's `Begin`, `Chunk`, `End` or `Error`), and returns when it
    /// is on the socket.
    ///
    /// # Errors
    /// [`Error::Internal`] for a frame above the message limit; the reason the connection ended.
    pub async fn send_binary(&self, frame: Vec<u8>) -> Result<(), Error> {
        self.fit(frame.len())?;
        self.shared.send(Message::binary(frame)).await
    }

    fn fit(&self, bytes: usize) -> Result<(), Error> {
        if bytes > self.shared.limits.max_message_bytes { Err(Error::Internal("a frame is longer than the message limit")) } else { Ok(()) }
    }

    /// Registers an upload's `transferId`, so that its `file_upload_complete` is kept for the
    /// returned wait. Register before the request is sent. A wait that is dropped forgets the id,
    /// and a `file_upload_complete` that comes after that is ignored.
    ///
    /// # Errors
    /// [`Error::Internal`] when the id is already registered; the reason the connection ended.
    pub fn expect_upload(&self, transfer_id: &str) -> Result<UploadWait, Error> {
        UploadWait::new(&self.shared, transfer_id)
    }

    /// Takes a free stream id for a download and routes the binary frames on it to the returned
    /// [`Download`]. Ask the daemon to send the file on [`Download::stream`].
    ///
    /// # Errors
    /// [`Error::Internal`] when all 256 streams are in use; the reason the connection ended.
    pub fn download(&self) -> Result<Download, Error> {
        Download::new(&self.shared)
    }

    /// Ends the connection at once with 1001 and no wait, whatever is in flight. For a caller that is
    /// going away and cannot wait: [`close`](Self::close) is the polite end.
    pub fn hang_up(&self) {
        self.shared.end(Error::Closed(Ended::Local), Some(CloseCode::Away));
    }

    /// Waits until the connection has ended, and says why. Returns at once when it has.
    pub async fn ended(&self) -> Error {
        let mut stop = self.shared.subscribe();
        let _ = stop.wait_for(|ended| *ended).await;
        self.shared.ended_error()
    }

    /// Closes the connection: sends a close frame, waits for the daemon's up to the close wait, and
    /// ends it either way. Waiters are told [`Ended::Local`]. Does nothing to a connection that has ended.
    pub async fn close(&self, how: Close) {
        let began = self.shared.begin_close();
        let _ = timeout(self.shared.limits.close_wait, async {
            if began {
                let _ = self.shared.send_close(close_message(how.code())).await;
            }
            self.ended().await
        })
        .await;
        self.shared.end(Error::Closed(Ended::Local), None);
    }
}

impl Drop for Connection {
    fn drop(&mut self) {
        self.hang_up();
    }
}
