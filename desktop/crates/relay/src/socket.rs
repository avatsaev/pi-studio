//! The open channel as a daemon socket (`desktop-relay-ssh.md` § 5, § 6): one message in, one sealed frame
//! out, and the other way round. The proxy and the transfer engine take it like any other socket.
//!
//! A message sealed as a frame is its payload plus a kind byte and the 16-byte tag; a frame above
//! [`MAX_SEALED_BYTES`] is refused as the relay's library reads it (1009, S4). A frame that does not open
//! delivers nothing: the socket sends the relay a close 4200 and reports that close as the next message, so
//! the proxy closes the page's leg with 4200 too. The relay's own close code and reason pass through.

use std::io;
use std::pin::Pin;
use std::task::{Context, Poll, ready};

use futures_util::future::BoxFuture;
use futures_util::{Sink, Stream};
use pistudiodesktop_net::{DaemonSocket, Wire};
use tokio_tungstenite::tungstenite::error::{CapacityError, ProtocolError};
use tokio_tungstenite::tungstenite::protocol::CloseFrame;
use tokio_tungstenite::tungstenite::protocol::frame::coding::CloseCode;
use tokio_tungstenite::tungstenite::{Error as WsError, Message};

use crate::channel::{Channel, Record, RecordKind};
use crate::connect::{CLOSE_CHANNEL_ERROR, CLOSE_CHANNEL_ERROR_REASON, Connected};

/// The largest sealed frame either way: 100 MiB.
pub const MAX_SEALED_BYTES: usize = 100 * 1024 * 1024;
/// What sealing adds to a message: the kind byte and the 16-byte tag.
pub const SEAL_OVERHEAD: usize = 1 + 16;

/// The largest message whose sealed frame is within [`MAX_SEALED_BYTES`] and `limit`.
#[must_use]
pub fn plain_limit(limit: usize) -> usize {
    limit.min(MAX_SEALED_BYTES - SEAL_OVERHEAD)
}

/// The sealed frame limit for messages of at most `limit` bytes.
#[must_use]
pub fn sealed_limit(limit: usize) -> usize {
    plain_limit(limit) + SEAL_OVERHEAD
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Phase {
    Open,
    /// A frame failed: the close 4200 is yet to be sent and reported.
    Failing,
    /// The close was sent: data is dropped, only the end is read.
    Failed,
}

/// The relay socket with its channel.
struct RelaySocket {
    inner: DaemonSocket,
    channel: Channel,
    max_plain: usize,
    phase: Phase,
}

fn channel_close() -> CloseFrame {
    CloseFrame { code: CloseCode::from(CLOSE_CHANNEL_ERROR), reason: CLOSE_CHANNEL_ERROR_REASON.into() }
}

impl Connected {
    /// The open connection as a daemon socket. Its message limit is the one the connect was given
    /// (at most [`MAX_SEALED_BYTES`] sealed).
    #[must_use]
    pub fn into_socket(self) -> DaemonSocket {
        let max_plain = plain_limit(self.socket.max_message_bytes().saturating_sub(SEAL_OVERHEAD));
        DaemonSocket::from_wire(RelaySocket { inner: self.socket, channel: self.channel, max_plain, phase: Phase::Open }, max_plain)
    }
}

impl Stream for RelaySocket {
    type Item = Result<Message, WsError>;

    fn poll_next(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Option<Self::Item>> {
        let this = &mut *self;
        loop {
            if this.phase == Phase::Failing {
                let _ = ready!(Pin::new(&mut this.inner).poll_ready(cx));
                // A close that cannot be queued leaves the socket to end by itself.
                let _ = Pin::new(&mut this.inner).start_send(Message::Close(Some(channel_close())));
                this.phase = Phase::Failed;
                return Poll::Ready(Some(Ok(Message::Close(Some(channel_close())))));
            }
            let message = match ready!(Pin::new(&mut this.inner).poll_next(cx)) {
                Some(Ok(message)) => message,
                other => return Poll::Ready(other),
            };
            match message {
                Message::Binary(frame) => {
                    if this.phase == Phase::Failed {
                        continue;
                    }
                    match this.channel.open(&frame) {
                        Ok(Record::Text(text)) => return Poll::Ready(Some(Ok(Message::text(text)))),
                        Ok(Record::Binary(bytes)) => return Poll::Ready(Some(Ok(Message::binary(bytes)))),
                        Err(_) => this.phase = Phase::Failing,
                    }
                }
                // After the channel opened every data frame is a binary box.
                Message::Text(_) => {
                    if this.phase == Phase::Open {
                        this.phase = Phase::Failing;
                    }
                }
                other => return Poll::Ready(Some(Ok(other))),
            }
        }
    }
}

impl Sink<Message> for RelaySocket {
    type Error = WsError;

    fn poll_ready(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Result<(), Self::Error>> {
        Pin::new(&mut self.inner).poll_ready(cx)
    }

    fn start_send(mut self: Pin<&mut Self>, item: Message) -> Result<(), Self::Error> {
        let this = &mut *self;
        let (kind, payload): (RecordKind, &[u8]) = match &item {
            Message::Text(text) => (RecordKind::Text, text.as_bytes()),
            Message::Binary(bytes) => (RecordKind::Binary, bytes),
            Message::Close(_) => return Pin::new(&mut this.inner).start_send(item),
            // Pings are the library's business on the relay leg; none is sent through.
            _ => return Ok(()),
        };
        if this.phase != Phase::Open {
            return Err(WsError::Protocol(ProtocolError::SendAfterClosing));
        }
        if payload.len() > this.max_plain {
            return Err(WsError::Capacity(CapacityError::MessageTooLong { size: payload.len(), max_size: this.max_plain }));
        }
        let sealed = this.channel.seal(kind, payload).map_err(|error| WsError::Io(io::Error::other(error)))?;
        Pin::new(&mut this.inner).start_send(Message::binary(sealed))
    }

    fn poll_flush(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Result<(), Self::Error>> {
        Pin::new(&mut self.inner).poll_flush(cx)
    }

    fn poll_close(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Result<(), Self::Error>> {
        Pin::new(&mut self.inner).poll_close(cx)
    }
}

impl Wire for RelaySocket {
    fn discard(&mut self) -> BoxFuture<'_, ()> {
        self.inner.discard()
    }
}

#[cfg(test)]
mod tests;
