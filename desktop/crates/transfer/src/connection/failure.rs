//! What a failed read or write of the socket means for the connection.

use tokio_tungstenite::tungstenite::Error as WsError;
use tokio_tungstenite::tungstenite::error::ProtocolError;
use tokio_tungstenite::tungstenite::protocol::frame::coding::CloseCode;

use crate::Error;
use crate::error::Ended;

/// Why a read of the socket failed.
///
/// A message above the limit, text that is not UTF-8 and broken framing are the daemon's fault
/// and end the connection with [`Error::Protocol`]. A reset, a refused read and an end with no close
/// frame are the network's, and end it with [`Ended::Socket`]. The library's own words are not
/// repeated: some of them hold what the daemon sent.
pub(super) fn read(error: &WsError) -> Error {
    match error {
        WsError::Capacity(_) => protocol("a message is longer than the limit"),
        WsError::Utf8(_) => protocol("a text frame is not valid UTF-8"),
        // The daemon's end of the socket went away without the closing handshake: not a lie, a loss.
        WsError::Protocol(ProtocolError::ResetWithoutClosingHandshake) => Error::Closed(Ended::Socket),
        WsError::Protocol(_) | WsError::AttackAttempt => protocol("the WebSocket framing is broken"),
        WsError::ConnectionClosed | WsError::AlreadyClosed => Error::Closed(Ended::Remote(None)),
        _ => Error::Closed(Ended::Socket),
    }
}

/// Why a write to the socket failed. A write fails only because the socket is gone or already closed.
pub(super) fn write(_error: &WsError) -> Error {
    Error::Closed(Ended::Socket)
}

/// The close code that tells the daemon why the engine hung up, when the reason is the daemon's
/// protocol error (1002). Any other end sends no code of its own.
pub(super) fn farewell(reason: &Error) -> Option<CloseCode> {
    matches!(reason, Error::Protocol(_)).then_some(CloseCode::Protocol)
}

fn protocol(text: &str) -> Error {
    Error::Protocol(text.to_owned())
}
