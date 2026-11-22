//! One direction of the pump: messages from one leg to the other, unchanged and in order.
//!
//! **What is held.** A direction reads its next messages only while the write of the previous ones
//! is not pending. It writes a batch (what has already arrived, up to [`Limits::flush_bytes`] or
//! [`Limits::flush_messages`]) and waits for the write to complete before reading again, so it
//! holds at most a batch and the message that ended it, whatever the sender does; a leg that is
//! not read slows the other through TCP. `Conn::held` records the peak.
//!
//! **What passes.** Text as text and binary as binary. A leg answers its own pings (the library
//! does it as it reads and writes); pings and pongs are not passed on, and none is sent.
//!
//! A direction ends with an [`Event`] and gives its two halves back, so that the connection's task
//! can finish the close handshakes with both legs in hand.

use futures_util::stream::{SplitSink, SplitStream};
use futures_util::{FutureExt as _, SinkExt as _, StreamExt as _};
use tokio::io::{AsyncRead, AsyncWrite};
use tokio::sync::oneshot;
use tokio_tungstenite::WebSocketStream;
use tokio_tungstenite::tungstenite::Error as WsError;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::tungstenite::error::ProtocolError;
use tokio_tungstenite::tungstenite::protocol::CloseFrame;

use super::conn::{Conn, Dir};
use crate::limits::Limits;

/// How a leg ended without a close frame.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Loss {
    /// It reset, or closed the socket, or the connection broke.
    Reset,
    /// It broke the protocol (a malformed frame, text that is not UTF-8).
    Invalid,
}

/// Why a direction stopped.
#[derive(Debug, PartialEq, Eq)]
pub(super) enum Event {
    /// The connection's task asked it to stop.
    Stopped,
    /// The source leg sent a close frame. Everything before it has been written.
    Close(Option<CloseFrame>),
    /// The source leg ended without one.
    SourceLost(Loss),
    /// The source leg sent a message above the limit.
    TooLarge,
    /// A write to the sink leg failed: that leg is gone.
    SinkLost,
    /// A write found the sink leg already closing, which means its close frame reached the other
    /// direction and that one is about to report it.
    SinkClosing,
}

/// A direction that has ended, with its halves.
pub(super) struct Pumped<A, B> {
    pub(super) event: Event,
    pub(super) from: SplitStream<WebSocketStream<A>>,
    pub(super) to: SplitSink<WebSocketStream<B>, Message>,
}

/// What one read of the source turned into.
enum Step {
    Data(Message),
    Close(Option<CloseFrame>),
    /// A ping, a pong or a raw frame: answered by the library or not ours.
    Skip,
    Ended(Event),
}

fn classify(item: Option<Result<Message, WsError>>) -> Step {
    match item {
        Some(Ok(message @ (Message::Text(_) | Message::Binary(_)))) => Step::Data(message),
        Some(Ok(Message::Close(frame))) => Step::Close(frame),
        Some(Ok(Message::Ping(_) | Message::Pong(_) | Message::Frame(_))) => Step::Skip,
        Some(Err(error)) => Step::Ended(source_event(&error)),
        None => Step::Ended(Event::SourceLost(Loss::Reset)),
    }
}

/// What a failed read means.
fn source_event(error: &WsError) -> Event {
    match error {
        WsError::Capacity(_) => Event::TooLarge,
        WsError::Io(_) | WsError::ConnectionClosed | WsError::AlreadyClosed | WsError::Protocol(ProtocolError::ResetWithoutClosingHandshake) => {
            Event::SourceLost(Loss::Reset)
        }
        _ => Event::SourceLost(Loss::Invalid),
    }
}

/// What a failed write means.
fn sink_event(error: &WsError) -> Event {
    match error {
        WsError::Capacity(_) => Event::TooLarge,
        WsError::ConnectionClosed | WsError::AlreadyClosed | WsError::Protocol(ProtocolError::SendAfterClosing) => Event::SinkClosing,
        _ => Event::SinkLost,
    }
}

/// The payload that counts: text and binary.
fn payload_len(message: &Message) -> u64 {
    match message {
        Message::Text(text) => text.len() as u64,
        Message::Binary(bytes) => bytes.len() as u64,
        _ => 0,
    }
}

/// The messages written but not yet flushed.
#[derive(Default)]
struct Batch {
    frames: u64,
    bytes: u64,
}

impl Batch {
    fn full(&self, limits: &Limits) -> bool {
        self.bytes >= limits.flush_bytes as u64 || self.frames >= limits.flush_messages as u64
    }
}

/// Flushes `to` and, when it worked, counts the batch as delivered.
async fn flush<B>(to: &mut SplitSink<WebSocketStream<B>, Message>, conn: &Conn, dir: Dir, batch: &mut Batch) -> Result<(), WsError>
where
    B: AsyncRead + AsyncWrite + Unpin,
{
    let flushed = to.flush().await;
    if flushed.is_ok() {
        conn.delivered(dir, batch.frames, batch.bytes);
    }
    *batch = Batch::default();
    flushed
}

/// Writes what is held, then reports `event` (or the write's failure, which is the more urgent news).
async fn finish<B>(to: &mut SplitSink<WebSocketStream<B>, Message>, conn: &Conn, dir: Dir, mut batch: Batch, event: Event) -> Event
where
    B: AsyncRead + AsyncWrite + Unpin,
{
    match flush(to, conn, dir, &mut batch).await {
        Ok(()) => event,
        Err(error) => sink_event(&error),
    }
}

/// Messages from `from` to `to` until something ends the direction.
async fn forward<A, B>(
    from: &mut SplitStream<WebSocketStream<A>>,
    to: &mut SplitSink<WebSocketStream<B>, Message>,
    dir: Dir,
    conn: &Conn,
    limits: &Limits,
) -> Event
where
    A: AsyncRead + AsyncWrite + Unpin,
    B: AsyncRead + AsyncWrite + Unpin,
{
    loop {
        let mut batch = Batch::default();
        let mut step = classify(from.next().await);
        loop {
            match step {
                Step::Data(message) => {
                    batch.frames += 1;
                    batch.bytes += payload_len(&message);
                    conn.held(dir, batch.bytes);
                    if let Err(error) = to.feed(message).await {
                        return sink_event(&error);
                    }
                    if batch.full(limits) {
                        break;
                    }
                }
                Step::Skip => {}
                Step::Close(frame) => return finish(to, conn, dir, batch, Event::Close(frame)).await,
                Step::Ended(event) => return finish(to, conn, dir, batch, event).await,
            }
            // What has already arrived goes into the same write; nothing is waited for.
            match from.next().now_or_never() {
                Some(item) => step = classify(item),
                None => break,
            }
        }
        if let Err(error) = flush(to, conn, dir, &mut batch).await {
            return sink_event(&error);
        }
    }
}

/// One direction, until it ends or `stop` fires (or its sender is dropped).
pub(super) async fn pump<A, B>(
    mut from: SplitStream<WebSocketStream<A>>,
    mut to: SplitSink<WebSocketStream<B>, Message>,
    dir: Dir,
    conn: std::sync::Arc<Conn>,
    limits: Limits,
    stop: oneshot::Receiver<()>,
) -> Pumped<A, B>
where
    A: AsyncRead + AsyncWrite + Unpin,
    B: AsyncRead + AsyncWrite + Unpin,
{
    let event = tokio::select! {
        biased;
        _ = stop => Event::Stopped,
        event = forward(&mut from, &mut to, dir, &conn, &limits) => event,
    };
    Pumped { event, from, to }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use tokio::io::DuplexStream;
    use tokio_tungstenite::tungstenite::protocol::Role;

    use super::*;

    /// Two WebSocket ends joined by memory: (client, server).
    async fn pair() -> (WebSocketStream<DuplexStream>, WebSocketStream<DuplexStream>) {
        let (a, b) = tokio::io::duplex(64 * 1024);
        (WebSocketStream::from_raw_socket(a, Role::Client, None).await, WebSocketStream::from_raw_socket(b, Role::Server, None).await)
    }

    /// The race behind `SinkClosing`: the other direction has just read the sink leg's close frame,
    /// and this one writes before it has reported it.
    #[tokio::test]
    async fn a_write_to_a_leg_whose_close_was_just_read_says_the_leg_is_closing() {
        let (mut source_client, source_server) = pair().await;
        let (sink_local, mut sink_remote) = pair().await;
        let (sink, mut sink_reads) = sink_local.split();
        let (_, from) = source_server.split();
        sink_remote.send(Message::Close(None)).await.unwrap();
        assert!(matches!(sink_reads.next().await, Some(Ok(Message::Close(_)))));
        source_client.send(Message::text("late")).await.unwrap();
        let (_keep, stop) = oneshot::channel();
        let pumped = pump(from, sink, Dir::ToDaemon, Arc::new(Conn::new()), Limits::default(), stop).await;
        assert_eq!(pumped.event, Event::SinkClosing);
    }

    #[tokio::test]
    async fn a_direction_stops_when_told_to_and_gives_its_halves_back() {
        let (_source_client, source_server) = pair().await;
        let (sink_local, _sink_remote) = pair().await;
        let (sink, _) = sink_local.split();
        let (_, from) = source_server.split();
        let (stop_tx, stop) = oneshot::channel();
        let running = tokio::spawn(pump(from, sink, Dir::ToPage, Arc::new(Conn::new()), Limits::default(), stop));
        tokio::task::yield_now().await;
        stop_tx.send(()).unwrap();
        assert_eq!(running.await.unwrap().event, Event::Stopped);
    }

    #[test]
    fn reads_and_writes_that_fail_are_told_apart() {
        let io = || WsError::Io(std::io::Error::from(std::io::ErrorKind::ConnectionReset));
        assert_eq!(source_event(&io()), Event::SourceLost(Loss::Reset));
        assert_eq!(source_event(&WsError::Protocol(ProtocolError::ResetWithoutClosingHandshake)), Event::SourceLost(Loss::Reset));
        assert_eq!(source_event(&WsError::Utf8("bad".into())), Event::SourceLost(Loss::Invalid));
        assert_eq!(source_event(&WsError::Protocol(ProtocolError::UnexpectedContinueFrame)), Event::SourceLost(Loss::Invalid));
        assert_eq!(sink_event(&io()), Event::SinkLost);
        assert_eq!(sink_event(&WsError::Protocol(ProtocolError::SendAfterClosing)), Event::SinkClosing);
        assert_eq!(sink_event(&WsError::AlreadyClosed), Event::SinkClosing);
    }

    #[test]
    fn a_batch_is_full_at_either_limit() {
        let limits = Limits { flush_bytes: 100, flush_messages: 3, ..Limits::default() };
        assert!(!Batch { frames: 2, bytes: 99 }.full(&limits));
        assert!(Batch { frames: 2, bytes: 100 }.full(&limits));
        assert!(Batch { frames: 3, bytes: 0 }.full(&limits));
    }

    #[test]
    fn only_text_and_binary_count() {
        assert_eq!(payload_len(&Message::text("héllo")), 6);
        assert_eq!(payload_len(&Message::binary(vec![0u8; 9])), 9);
        assert_eq!(payload_len(&Message::Ping(vec![1, 2, 3].into())), 0);
    }
}
