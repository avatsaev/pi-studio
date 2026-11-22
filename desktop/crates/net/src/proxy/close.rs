//! Ending a connection: what each leg is told, and how long its handshake may take.
//!
//! Every procedure runs with both legs in hand, after the pump has stopped, and is bounded by one
//! time limit: a leg that does not answer is dropped. A failed write is ignored: the leg is gone,
//! which is what these procedures aim at anyway.

use std::time::Duration;

use futures_util::{SinkExt as _, StreamExt as _};
use tokio::io::{AsyncRead, AsyncReadExt as _, AsyncWrite};
use tokio::time::timeout;
use tokio_tungstenite::WebSocketStream;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::tungstenite::protocol::CloseFrame;
use tokio_tungstenite::tungstenite::protocol::frame::coding::CloseCode;

/// A close frame with `code` and no reason.
fn close_with(code: CloseCode) -> Message {
    Message::Close(Some(CloseFrame { code, reason: "".into() }))
}

/// Reads and drops what the leg still sends, until it ends. The library answers a close frame and
/// finishes the handshake as it reads.
async fn drain<T>(leg: &mut WebSocketStream<T>)
where
    T: AsyncRead + AsyncWrite + Unpin,
{
    while let Some(Ok(_)) = leg.next().await {}
}

/// Reads and drops the bytes of the socket itself until it ends: for a leg whose frames can no
/// longer be parsed (it sent a frame above the limit and the rest of it is still coming), so that
/// closing the socket does not reset it before its close frame has been read.
async fn discard<T>(socket: &mut T)
where
    T: AsyncRead + Unpin,
{
    let mut scratch = [0u8; 8192];
    while let Ok(read) = socket.read(&mut scratch).await {
        if read == 0 {
            break;
        }
    }
}

/// `leg` is told 1001 and given `wait` to answer. For the daemon's leg when the page's is gone or
/// the connection is shut down.
pub(super) async fn say_goodbye<T>(leg: &mut WebSocketStream<T>, wait: Duration)
where
    T: AsyncRead + AsyncWrite + Unpin,
{
    let _ = timeout(wait, async {
        let _ = leg.send(close_with(CloseCode::Away)).await;
        drain(leg).await;
    })
    .await;
}

/// `closer` sent a close frame: it goes to `other` with its code and reason, `closer` is answered
/// (the library echoes the frame; `flush` sends the echo now), and both legs are given `wait` to
/// finish. Data that either leg sends meanwhile is dropped: after a close frame there is none.
pub(super) async fn relay_close<A, B>(closer: &mut WebSocketStream<A>, other: &mut WebSocketStream<B>, frame: Option<CloseFrame>, wait: Duration)
where
    A: AsyncRead + AsyncWrite + Unpin,
    B: AsyncRead + AsyncWrite + Unpin,
{
    let _ = timeout(wait, async {
        let _ = other.send(Message::Close(frame)).await;
        let _ = closer.flush().await;
        tokio::join!(drain(closer), drain(other));
    })
    .await;
}

/// `offender` sent a message above the limit: both legs are closed with 1009 and given `wait`.
pub(super) async fn refuse_oversize<A, B>(offender: &mut WebSocketStream<A>, other: &mut WebSocketStream<B>, wait: Duration)
where
    A: AsyncRead + AsyncWrite + Unpin,
    B: AsyncRead + AsyncWrite + Unpin,
{
    let _ = timeout(wait, async {
        tokio::join!(
            async {
                let _ = other.send(close_with(CloseCode::Size)).await;
                drain(other).await;
            },
            async {
                let _ = offender.send(close_with(CloseCode::Size)).await;
                discard(offender.get_mut()).await;
            },
        );
    })
    .await;
}
