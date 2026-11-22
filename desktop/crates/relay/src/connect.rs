//! Connecting to a daemon through a relay (`relay-protocol.md` § Client, `desktop-relay-ssh.md` § 5), the
//! way `createRelayTransport` does in `packages/client/src/relay-transport.ts`:
//!
//! 1. dial the relay's own address ([`pistudiodesktop_net::dial`]: no password, no subprotocol);
//! 2. send `relay_client_connect` and wait for `relay_paired` (`relay_registered` is ignored, anything
//!    else is a protocol error);
//! 3. with a key pair of this connection only, send the channel's `hello` and wait for the daemon's
//!    `ready`, which must open;
//! 4. hand back the open socket and its [`Channel`].
//!
//! The whole of it, dial included, takes at most [`CONNECT_LIMIT`]. Every failure is a [`RelayError`]
//! with the SDK's reason, by the SDK's rules: a close 4102–4105 is named; a close 4200 after pairing, or a
//! `ready` that does not open, is `wrong_key` (and the client then closes 4200 itself); a close without a
//! code before the relay paired, or a dial that fails for any reason but its time limit, is
//! `relay_unreachable`; anything else is `protocol_error`. Every frame is hostile: control frames are read
//! only up to a few KiB, and nothing here keeps what a relay says beyond a cleaned close reason.

use std::time::Duration;

use futures_util::{SinkExt as _, StreamExt as _};
use pistudiodesktop_net::{DaemonSocket, DialError, ErrorCode, dial};
use serde_json::Value;
use tokio::time::{Instant, timeout, timeout_at};
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::tungstenite::protocol::CloseFrame;
use tokio_tungstenite::tungstenite::protocol::frame::coding::CloseCode;

use crate::channel::{Channel, KEY_LENGTH, KeyPair};
use crate::reason::{RelayError, RelayReason};
use crate::session_id::session_id;
use crate::socket::sealed_limit;

/// How long a connect may take, in all: the dial, the pairing and the key exchange.
pub const CONNECT_LIMIT: Duration = Duration::from_secs(15);

/// The largest control frame read before the channel opens. The relay's are under 100 bytes; a longer
/// text frame is not one, and is refused without being parsed.
const MAX_CONTROL_FRAME: usize = 4096;
/// A `connectionId`: 128 random bits as lowercase hexadecimal.
const CONNECTION_ID_LENGTH: usize = 32;
/// How long the client's own close frame may take to leave.
const CLOSE_WAIT: Duration = Duration::from_secs(2);

/// Close codes the relay uses toward a client (`relay-protocol.md` § 3) and the channel's.
const CLOSE_DAEMON_OFFLINE: u16 = 4102;
const CLOSE_DAEMON_UNRESPONSIVE: u16 = 4103;
const CLOSE_TOO_MANY_CLIENTS: u16 = 4104;
const CLOSE_DAEMON_OUTDATED: u16 = 4105;
/// `channel_error`: what a client closes with when a channel frame fails, and what the daemon's own
/// refusal of a client's frame arrives as.
pub const CLOSE_CHANNEL_ERROR: u16 = 4200;
/// The reason string of [`CLOSE_CHANNEL_ERROR`].
pub const CLOSE_CHANNEL_ERROR_REASON: &str = "channel_error";
/// Codes that stand for "no close frame" (RFC 6455 § 7.4.1): they are never on the wire.
const NO_CLOSE_FRAME_CODES: [u16; 3] = [1005, 1006, 1015];

/// An open connection to a daemon through a relay: the WebSocket to the relay, which has paired, and
/// the channel whose `ready` box opened. Every later frame on `socket` is a box of `channel`.
#[derive(Debug)]
pub struct Connected {
    pub socket: DaemonSocket,
    pub channel: Channel,
}

/// How a connect that failed leaves the socket.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Closing {
    /// The relay closed it, or it is gone: nothing to send.
    Gone,
    /// A close 1000, as the SDK sends when it gives up.
    Normal,
    /// A close 4200: a channel frame failed.
    ChannelError,
}

struct Failure {
    error: RelayError,
    closing: Closing,
}

impl Failure {
    fn new(error: RelayError, closing: Closing) -> Self {
        Self { error, closing }
    }

    fn protocol(detail: &str) -> Self {
        Self::new(RelayError::with_detail(RelayReason::ProtocolError, detail), Closing::Normal)
    }

    /// A channel frame failed: the key is not the daemon's, or the daemon is not what it says.
    fn channel_error() -> Self {
        Self::new(RelayError::with_detail(RelayReason::WrongKey, CLOSE_CHANNEL_ERROR_REASON), Closing::ChannelError)
    }

    /// The socket ended, or the relay closed it with `close` (code and reason), `paired` saying whether
    /// the relay had answered.
    fn closed(close: Option<(u16, String)>, paired: bool) -> Self {
        let (code, reason) = match close {
            Some((code, reason)) => (Some(code), reason),
            None => (None, String::new()),
        };
        Self::new(RelayError::with_detail(close_reason(code, paired), &reason), Closing::Gone)
    }
}

/// The reason a close that ended the connect stands for (`closeReason` of the SDK). `code` is `None` for
/// a socket that ended without a close frame.
fn close_reason(code: Option<u16>, paired: bool) -> RelayReason {
    match code {
        Some(CLOSE_DAEMON_OFFLINE) => RelayReason::DaemonOffline,
        Some(CLOSE_DAEMON_UNRESPONSIVE) => RelayReason::DaemonUnresponsive,
        Some(CLOSE_TOO_MANY_CLIENTS) => RelayReason::TooManyClients,
        Some(CLOSE_DAEMON_OUTDATED) => RelayReason::DaemonOutdated,
        Some(CLOSE_CHANNEL_ERROR) if paired => RelayReason::WrongKey,
        None if !paired => RelayReason::RelayUnreachable,
        _ => RelayReason::ProtocolError,
    }
}

/// What a text frame of the relay says before the channel opens.
#[derive(Debug, PartialEq, Eq)]
enum Control {
    Paired,
    Registered,
    /// Anything else: not JSON, no `type`, an unknown type, a `relay_paired` without a valid `connectionId`.
    Other,
}

fn is_connection_id(text: &str) -> bool {
    text.len() == CONNECTION_ID_LENGTH && text.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

/// `parseRelayFrame` of `packages/relay`, for the two frames a client may get.
fn classify(text: &str) -> Control {
    if text.len() > MAX_CONTROL_FRAME {
        return Control::Other;
    }
    let Ok(Value::Object(object)) = serde_json::from_str::<Value>(text) else {
        return Control::Other;
    };
    match object.get("type").and_then(Value::as_str) {
        Some("relay_registered") => Control::Registered,
        Some("relay_paired") if object.get("connectionId").and_then(Value::as_str).is_some_and(is_connection_id) => Control::Paired,
        _ => Control::Other,
    }
}

/// What the socket gave: a text or binary frame, or its end.
enum Event {
    Frame(Message),
    /// A close frame's code and reason (a code that stands for "no close frame" is `None`), or a socket
    /// that ended or failed without one.
    Closed(Option<(u16, String)>),
}

/// The next frame that is not a ping or a pong (the library answers a ping itself).
async fn next_event(socket: &mut DaemonSocket) -> Event {
    loop {
        match socket.next().await {
            Some(Ok(Message::Ping(_) | Message::Pong(_) | Message::Frame(_))) => {}
            Some(Ok(Message::Close(frame))) => {
                let close = frame.map(|f| (u16::from(f.code), f.reason.as_str().to_owned())).filter(|(code, _)| !NO_CLOSE_FRAME_CODES.contains(code));
                return Event::Closed(close);
            }
            Some(Ok(message)) => return Event::Frame(message),
            Some(Err(_)) | None => return Event::Closed(None),
        }
    }
}

/// Dial the relay at `url` (`ws://` or `wss://`) for the daemon whose public key is `daemon_key`, pair, and
/// open the channel, within `limit` (at most [`CONNECT_LIMIT`]: a longer one is cut to it).
/// `max_message_bytes` is the largest message the socket carries once open (at most 100 MiB sealed).
///
/// # Errors
/// A [`RelayError`] with the SDK's reason; see the module's rules. The socket is closed when a failure
/// leaves it open.
pub async fn connect(url: &str, daemon_key: &[u8; KEY_LENGTH], max_message_bytes: usize, limit: Duration) -> Result<Connected, RelayError> {
    let limit = limit.min(CONNECT_LIMIT);
    let deadline = Instant::now() + limit;
    let mut socket = dial(url, None, limit, sealed_limit(max_message_bytes)).await.map_err(dial_failure)?;
    match timeout_at(deadline, exchange(&mut socket, daemon_key)).await {
        Ok(Ok(channel)) => Ok(Connected { socket, channel }),
        Ok(Err(failure)) => {
            close(&mut socket, failure.closing).await;
            Err(failure.error)
        }
        Err(_) => {
            close(&mut socket, Closing::Normal).await;
            Err(RelayError::new(RelayReason::Timeout))
        }
    }
}

/// A dial that failed: its time limit is `timeout`, anything else is `relay_unreachable` (S5).
fn dial_failure(error: DialError) -> RelayError {
    if error.code == ErrorCode::Timeout {
        RelayError::new(RelayReason::Timeout)
    } else {
        RelayError::with_detail(RelayReason::RelayUnreachable, &error.message)
    }
}

/// The messages of the connect, on an open socket: pairing, then the key exchange.
async fn exchange(socket: &mut DaemonSocket, daemon_key: &[u8; KEY_LENGTH]) -> Result<Channel, Failure> {
    let connect_frame = format!(r#"{{"type":"relay_client_connect","v":2,"sessionId":"{}"}}"#, session_id(daemon_key));
    socket.send(Message::text(connect_frame)).await.map_err(|_| Failure::closed(None, false))?;
    await_paired(socket).await?;

    let key_pair = KeyPair::generate().map_err(|error| Failure::protocol(&error.to_string()))?;
    let mut channel = Channel::new(daemon_key, &key_pair);
    socket.send(Message::binary(channel.hello())).await.map_err(|_| Failure::closed(None, true))?;
    await_ready(socket, &mut channel).await?;
    Ok(channel)
}

async fn await_paired(socket: &mut DaemonSocket) -> Result<(), Failure> {
    loop {
        match next_event(socket).await {
            Event::Frame(Message::Text(text)) => match classify(&text) {
                Control::Paired => return Ok(()),
                Control::Registered => {}
                Control::Other => return Err(Failure::protocol("unexpected frame before relay_paired")),
            },
            Event::Frame(_) => return Err(Failure::protocol("unexpected frame before relay_paired")),
            Event::Closed(close) => return Err(Failure::closed(close, false)),
        }
    }
}

/// The daemon's first frame must be a binary `ready` that opens. A text frame is a channel error too
/// (`relay-protocol.md` § 4).
async fn await_ready(socket: &mut DaemonSocket, channel: &mut Channel) -> Result<(), Failure> {
    match next_event(socket).await {
        Event::Frame(Message::Binary(frame)) => channel.accept_ready(&frame).map_err(|_| Failure::channel_error()),
        Event::Frame(_) => Err(Failure::channel_error()),
        Event::Closed(close) => Err(Failure::closed(close, true)),
    }
}

/// Sends the client's close frame, if the failure leaves one to send; a relay that does not take it in
/// [`CLOSE_WAIT`] loses the socket when the caller drops it.
async fn close(socket: &mut DaemonSocket, closing: Closing) {
    let frame = match closing {
        Closing::Gone => return,
        Closing::Normal => CloseFrame { code: CloseCode::Normal, reason: "".into() },
        Closing::ChannelError => CloseFrame { code: CloseCode::from(CLOSE_CHANNEL_ERROR), reason: CLOSE_CHANNEL_ERROR_REASON.into() },
    };
    // A close that cannot be sent leaves the socket to be dropped, which ends it all the same.
    let _ = timeout(CLOSE_WAIT, socket.send(Message::Close(Some(frame)))).await;
}

#[cfg(test)]
mod tests;
