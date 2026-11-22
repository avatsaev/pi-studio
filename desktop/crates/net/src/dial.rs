//! Opening a WebSocket to a daemon: resolve, connect, TLS for `wss`, the upgrade, all within one
//! time limit, and a precise reason when it fails.
//!
//! What the caller gets is an open [`Socket`]; reading and writing it is the pump's business.

use std::time::Duration;

use tokio::time::timeout;
use tokio_rustls::rustls::pki_types::CertificateDer;
use tokio_tungstenite::tungstenite::handshake::client::{Request, generate_key};
use tokio_tungstenite::tungstenite::protocol::WebSocketConfig;
use tokio_tungstenite::tungstenite::{self, http::StatusCode};
use tokio_tungstenite::{WebSocketStream, client_async_with_config};

use crate::address::{Target, parse};
use crate::error::{DialError, ErrorCode};
use crate::limits::MAX_MESSAGE_BYTES;
use crate::stream::{ConnectError, Stream, connect_tcp};
use crate::tls;

/// How long a dial may take, in all, before it is a `timeout`.
pub const DIAL_LIMIT: Duration = Duration::from_secs(15);

/// The subprotocol a password is offered in: the daemon reads `pi-studio.bearer.<password>`.
const BEARER_PREFIX: &str = "pi-studio.bearer.";

/// An open WebSocket to the daemon.
pub type Socket = WebSocketStream<Stream>;

/// Opens a WebSocket to `url` (`ws` or `wss`) within `limit`.
///
/// With a non-empty `password` the upgrade offers the subprotocol `pi-studio.bearer.<password>`;
/// without one it offers none. The `Host` header is the URL's, as a browser would send it (the
/// daemon checks it, not `Origin`). A message is at most [`MAX_MESSAGE_BYTES`], the largest the
/// bridge carries; a longer one fails the socket.
///
/// A `wss` certificate must be trusted by the operating system's store: there is no way to accept
/// another.
///
/// # Errors
/// A [`DialError`], whose message names the host and port and never holds the password. An
/// address that is not `ws`/`wss`, or that has user information, fails before any network use.
pub async fn dial(url: &str, password: Option<&str>, limit: Duration) -> Result<Socket, DialError> {
    dial_with_roots(url, password, limit, Vec::new()).await
}

/// [`dial`] with extra trust anchors. Private: the crate's tests use it to trust a certificate
/// authority they made; nothing outside can add a root, let alone skip the verification.
async fn dial_with_roots(url: &str, password: Option<&str>, limit: Duration, extra_roots: Vec<CertificateDer<'static>>) -> Result<Socket, DialError> {
    let target = parse(url)?;
    let password = password.filter(|p| !p.is_empty());
    let request = build_request(&target, password)?;
    let display = target.display();
    match timeout(limit, open(&target, request, password.is_some(), extra_roots)).await {
        Ok(result) => result,
        Err(_) => Err(DialError::new(
            ErrorCode::Timeout,
            format!("{display} did not answer within {} s. Is the daemon running, and is the address right?", limit.as_secs().max(1)),
        )),
    }
}

async fn open(target: &Target, request: Request, has_password: bool, extra_roots: Vec<CertificateDer<'static>>) -> Result<Socket, DialError> {
    let display = target.display();
    let tcp = connect_tcp(&target.host, target.port).await.map_err(|e| unreachable(&e, &display))?;
    let stream = if target.secure { Stream::Tls(Box::new(tls::connect(tcp, &target.host, &display, extra_roots).await?)) } else { Stream::Plain(tcp) };
    let config = WebSocketConfig::default().max_message_size(Some(MAX_MESSAGE_BYTES)).max_frame_size(Some(MAX_MESSAGE_BYTES));
    match client_async_with_config(request, stream, Some(config)).await {
        Ok((socket, _response)) => Ok(socket),
        Err(e) => Err(upgrade_error(&e, &display, has_password)),
    }
}

/// The upgrade request, written by hand so that `Host` is what a browser would send.
fn build_request(target: &Target, password: Option<&str>) -> Result<Request, DialError> {
    // The library wants the scheme in the request's URI; only the path and query go on the wire.
    let scheme = if target.secure { "wss" } else { "ws" };
    let mut builder = Request::builder()
        .method("GET")
        .uri(format!("{scheme}://{}{}", target.host_header, target.path_and_query))
        .header("Host", &target.host_header)
        .header("Connection", "Upgrade")
        .header("Upgrade", "websocket")
        .header("Sec-WebSocket-Version", "13")
        .header("Sec-WebSocket-Key", generate_key());
    if let Some(password) = password {
        builder = builder.header("Sec-WebSocket-Protocol", subprotocol(password)?);
    }
    builder.body(()).map_err(|_| DialError::new(ErrorCode::InvalidAddress, "The daemon's address cannot be sent as a WebSocket request."))
}

/// `pi-studio.bearer.<password>`. A header holds visible ASCII and spaces; a comma would end the
/// protocol, since the daemon reads the header as a list. The message does not repeat the password.
fn subprotocol(password: &str) -> Result<String, DialError> {
    if password.bytes().all(|b| (0x20..0x7f).contains(&b) && b != b',') {
        Ok(format!("{BEARER_PREFIX}{password}"))
    } else {
        Err(DialError::new(
            ErrorCode::Handshake,
            "The password has characters that a WebSocket subprotocol cannot carry (a comma, a control character or a non-ASCII letter). Choose a password of printable ASCII without commas in Daemons, and set the same one on the daemon.",
        ))
    }
}

fn unreachable(error: &ConnectError, display: &str) -> DialError {
    let message = match error {
        ConnectError::Resolve => format!("Cannot find {display}: the name did not resolve. Check the address."),
        ConnectError::Connect(e) => format!("Cannot connect to {display}: {}. Is the daemon running, and is the address right?", e.kind()),
    };
    DialError::new(ErrorCode::Unreachable, message)
}

/// Turns a failed upgrade into the dial error that says why. Only the status and the kind of
/// failure are used, never the text of the library's error: some embed what was sent.
fn upgrade_error(error: &tungstenite::Error, display: &str, has_password: bool) -> DialError {
    match error {
        tungstenite::Error::Http(response) => match response.status() {
            StatusCode::UNAUTHORIZED if has_password => {
                DialError::new(ErrorCode::Unauthorized, format!("The daemon at {display} refused the password (401). Enter the password again in Daemons."))
            }
            StatusCode::UNAUTHORIZED => {
                DialError::new(ErrorCode::Unauthorized, format!("The daemon at {display} needs a password (401). Enter it in Daemons."))
            }
            StatusCode::FORBIDDEN => DialError::new(
                ErrorCode::HostNotAllowed,
                format!(
                    "The daemon at {display} does not accept this host name (403). Add it to PI_STUDIO_HOSTNAMES on the daemon, or use an address it lists."
                ),
            ),
            status => DialError::new(
                ErrorCode::Handshake,
                format!("The daemon at {display} answered the WebSocket upgrade with {status}. Is this address a Pi Studio daemon?"),
            ),
        },
        tungstenite::Error::Protocol(p) => DialError::new(
            ErrorCode::Handshake,
            format!("The daemon at {display} did not complete the WebSocket upgrade correctly ({p}). Is this address a Pi Studio daemon?"),
        ),
        tungstenite::Error::Io(e) => {
            DialError::new(ErrorCode::Handshake, format!("The connection to {display} ended during the WebSocket upgrade ({}).", e.kind()))
        }
        _ => DialError::new(ErrorCode::Handshake, format!("The WebSocket upgrade with {display} failed.")),
    }
}

#[cfg(test)]
mod tests;
