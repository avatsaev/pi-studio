//! The first thing a connection does: say `hello` and wait for the daemon's `server_info`.

use futures_util::{SinkExt, StreamExt};
use pistudiodesktop_net::DaemonSocket;
use tokio::time::timeout;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::tungstenite::protocol::frame::coding::CloseCode;

use super::failure;
use super::shared::{close_message, pong_message};
use crate::Error;
use crate::error::Ended;
use crate::limits::Limits;
use crate::wire::inbound::Inbound;
use crate::wire::outbound;

/// Who is saying `hello`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Hello<'a> {
    /// The id the daemon knows this client by: random, made once per run of the app, and not the page's.
    pub client_id: &'a str,
    /// The `appVersion` of `hello`: `pistudiodesktop/<version>`.
    pub app_version: &'a str,
}

/// Sends `hello` and waits for the answer, within the answer time. On any failure the socket is
/// closed (best effort) before the error is returned.
pub(super) async fn run(socket: &mut DaemonSocket, hello: &Hello<'_>, limits: &Limits) -> Result<(), Error> {
    let outcome = timeout(limits.answer_wait, exchange(socket, hello)).await.unwrap_or(Err(Error::Timeout));
    if let Err(error) = &outcome {
        abandon(socket, error, limits).await;
    }
    outcome
}

async fn exchange(socket: &mut DaemonSocket, hello: &Hello<'_>) -> Result<(), Error> {
    socket.send(Message::text(outbound::hello(hello.client_id, hello.app_version))).await.map_err(|error| failure::write(&error))?;
    loop {
        match socket.next().await {
            None => return Err(Error::Closed(Ended::Remote(None))),
            Some(Err(error)) => return Err(failure::read(&error)),
            Some(Ok(Message::Close(frame))) => return Err(Error::Closed(Ended::Remote(frame.map(|frame| u16::from(frame.code))))),
            Some(Ok(Message::Text(text))) => match Inbound::parse(text.as_str())? {
                Inbound::ServerInfo(info) => return info.require_features(),
                // The only `status` the daemon sends is `server_info`: any other is not the daemon's.
                Inbound::Other { kind } if kind == "status" => return Err(Error::Protocol("the `status` frame is not a `server_info`".to_owned())),
                Inbound::Ping(ping) => socket.send(pong_message(&ping)).await.map_err(|error| failure::write(&error))?,
                _ => {}
            },
            // Binary frames, and the library's own ping and pong, are nothing the handshake waits for.
            Some(Ok(_)) => {}
        }
    }
}

/// Closes a socket whose handshake failed: 1002 for the daemon's protocol error, 1000 for any other
/// reason. A socket that is already gone is left alone.
async fn abandon(socket: &mut DaemonSocket, error: &Error, limits: &Limits) {
    if matches!(error, Error::Closed(_)) {
        return;
    }
    let code = failure::farewell(error).unwrap_or(CloseCode::Normal);
    let _ = timeout(limits.close_wait, socket.send(close_message(code))).await;
}
