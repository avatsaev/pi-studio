//! The reader task: the only code that reads the socket, and the one that tells whether the daemon
//! is still there.

use std::sync::Arc;

use futures_util::StreamExt;
use futures_util::stream::SplitStream;
use tokio::sync::watch;
use tokio::time::{Instant, sleep_until};
use tokio_tungstenite::WebSocketStream;
use tokio_tungstenite::tungstenite::{Bytes, Error as WsError, Message};

use super::Transport;
use super::download::{Chunk, Delivery, Frame, capacity, charge};
use super::failure;
use super::shared::{Shared, ping_message, pong_message, stopped};
use crate::error::{Ended, Error};
use crate::wire::binary::{self, FileFrame};
use crate::wire::inbound::Inbound;

/// Reads the socket until the connection ends.
///
/// Liveness: after the ping time with no frame of any kind from the daemon, a `ping` is queued (one
/// per silence); after the dropped time with none, the connection ends as [`Ended::Silent`]. The
/// time a frame spends waiting for its consumer does not count: the task is then not reading, so it
/// learns nothing about the daemon, and the silence starts again when it reads on.
///
/// Whatever is not for a waiter is ignored: a frame the engine did not ask for, a `ping`'s answer, a
/// binary frame that is not a running download's. A frame that breaks the protocol ends the
/// connection, with a close frame (1002) as the last thing sent.
pub(super) async fn run<S: Transport>(shared: Arc<Shared>, mut frames: SplitStream<WebSocketStream<S>>, mut stop: watch::Receiver<bool>) {
    let (ping_after, dropped_after) = (shared.limits.ping_after, shared.limits.dropped_after);
    let mut last_frame = Instant::now();
    let mut pinged = false;
    loop {
        let wake = last_frame + if pinged { dropped_after } else { ping_after };
        tokio::select! {
            biased;
            () = stopped(&mut stop) => return,
            message = frames.next() => {
                if let Err(reason) = take(&shared, message, &mut stop).await {
                    let farewell = failure::farewell(&reason);
                    shared.end(reason, farewell);
                    return;
                }
                last_frame = Instant::now();
                pinged = false;
            }
            () = sleep_until(wake) => {
                if pinged {
                    shared.end(Error::Closed(Ended::Silent), None);
                    return;
                }
                shared.try_control(ping_message(&shared.ping_id()));
                pinged = true;
            }
        }
    }
}

async fn take(shared: &Shared, message: Option<Result<Message, WsError>>, stop: &mut watch::Receiver<bool>) -> Result<(), Error> {
    match message {
        None => Err(Error::Closed(Ended::Remote(None))),
        Some(Err(error)) => Err(failure::read(&error)),
        Some(Ok(message)) => dispatch(shared, message, stop).await,
    }
}

/// Routes one message. An error ends the connection.
async fn dispatch(shared: &Shared, message: Message, stop: &mut watch::Receiver<bool>) -> Result<(), Error> {
    match message {
        Message::Text(text) => text_frame(shared, text.as_str()),
        Message::Binary(bytes) => binary_frame(shared, bytes, stop).await,
        Message::Close(frame) => Err(Error::Closed(Ended::Remote(frame.map(|frame| u16::from(frame.code))))),
        // The library answers a WebSocket `Ping` itself; either one shows the daemon is there.
        Message::Ping(_) | Message::Pong(_) | Message::Frame(_) => Ok(()),
    }
}

fn text_frame(shared: &Shared, text: &str) -> Result<(), Error> {
    match Inbound::parse(text)? {
        Inbound::Reply(reply) => {
            let id = reply.request_id.clone();
            shared.answer(&id, Ok(reply));
        }
        Inbound::RpcError(refused) => {
            if let Some(id) = refused.request_id {
                shared.answer(&id, Err(Error::Rpc { code: refused.code, message: refused.message }));
            }
        }
        Inbound::UploadComplete(complete) => shared.complete_upload(complete),
        Inbound::Ping(ping) => shared.try_control(pong_message(&ping)),
        // The handshake is over, so a `server_info` is not awaited; a `pong` has done its work by arriving.
        Inbound::ServerInfo(_) | Inbound::Pong { .. } | Inbound::Other { .. } => {}
    }
    Ok(())
}

/// Hands a file-transfer frame to the download on its stream, once the consumer has released
/// enough of what it was given before.
async fn binary_frame(shared: &Shared, bytes: Bytes, stop: &mut watch::Receiver<bool>) -> Result<(), Error> {
    // Another protocol's frame (the terminal's) shares the socket's binary frames: not ours.
    if !bytes.first().copied().is_some_and(binary::is_file_transfer) {
        return Ok(());
    }
    // A frame with no stream byte, or on a stream that is not a running download (one that was
    // cancelled or finished, or a frame nobody asked for), is not for any transfer.
    let Some(slot) = bytes.get(1).and_then(|stream| shared.stream_slot(*stream)) else {
        return Ok(());
    };
    let frame = match binary::decode(&bytes)? {
        FileFrame::Begin { meta, .. } => Frame::Begin(meta),
        FileFrame::Chunk { data, .. } => Frame::Chunk(Chunk::new(bytes.slice_ref(data))),
        FileFrame::End { ok, .. } => Frame::End { ok },
        FileFrame::Error { message, .. } => Frame::Error { message },
    };
    let cost = charge(capacity(&shared.limits), bytes.len());
    let permit = tokio::select! {
        biased;
        () = stopped(stop) => return Ok(()),
        permit = slot.hold.acquire_many_owned(cost) => match permit {
            Ok(permit) => permit,
            // The download was dropped while this frame waited: nobody wants it.
            Err(_) => return Ok(()),
        },
    };
    let _ = slot.frames.send(Delivery::new(frame, permit));
    Ok(())
}
