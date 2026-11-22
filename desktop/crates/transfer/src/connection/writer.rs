//! The writer task: the only code that writes to the socket.

use std::sync::Arc;

use futures_util::SinkExt;
use futures_util::stream::SplitSink;
use tokio::sync::watch;
use tokio::time::timeout;
use tokio_tungstenite::WebSocketStream;
use tokio_tungstenite::tungstenite::Message;

use super::Transport;
use super::failure;
use super::shared::{Mailboxes, Outgoing, Shared, stopped};
use crate::error::{Ended, Error};

type Sink<S> = SplitSink<WebSocketStream<S>, Message>;

/// Writes what the callers and the reader queue, one frame at a time, until the connection ends.
///
/// A frame is written whole before the next is taken, and the sender is told when it is on the
/// socket: a caller that waits for that never has more than its one frame queued. The control queue
/// is served first, so a `ping` or a `pong` goes out between two chunks.
///
/// A write that does not finish within the dropped time ends the connection as [`Ended::Silent`]:
/// nothing has moved for that long, which is how a stalled daemon is told from a slow one.
pub(super) async fn run<S: Transport>(shared: Arc<Shared>, mut sink: Sink<S>, mut mail: Mailboxes, mut stop: watch::Receiver<bool>) {
    let mut sound = true;
    loop {
        let item = tokio::select! {
            biased;
            () = stopped(&mut stop) => break,
            Some(item) = mail.control.recv() => item,
            Some(item) = mail.outbox.recv() => item,
            else => break,
        };
        if !write(&shared, &mut sink, item).await {
            sound = false;
            break;
        }
    }
    if sound {
        farewell(&shared, &mut sink, &mut mail).await;
    }
}

/// Writes one frame; false when the socket failed, which ended the connection.
async fn write<S: Transport>(shared: &Shared, sink: &mut Sink<S>, item: Outgoing) -> bool {
    let Outgoing { message, written } = item;
    match timeout(shared.limits.dropped_after, sink.send(message)).await {
        Ok(Ok(())) => {
            if let Some(written) = written {
                let _ = written.send(());
            }
            true
        }
        Ok(Err(error)) => {
            shared.end(failure::write(&error), None);
            false
        }
        Err(_) => {
            shared.end(Error::Closed(Ended::Silent), None);
            false
        }
    }
}

/// After the end: what the control queue still holds (the close frame of a protocol error, the
/// answer to the daemon's close), then the library's own close, so that the daemon sees a close
/// frame and not a reset. Best effort and bounded by the close wait: the connection is over either way.
async fn farewell<S: Transport>(shared: &Shared, sink: &mut Sink<S>, mail: &mut Mailboxes) {
    let _ = timeout(shared.limits.close_wait, async {
        while let Ok(item) = mail.control.try_recv() {
            if sink.send(item.message).await.is_err() {
                return;
            }
        }
        let _ = sink.close().await;
    })
    .await;
}
