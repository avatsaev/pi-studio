//! Where the engine gets its socket: from the caller, so that the crate knows nothing of the registry,
//! the address or the secret store.

use pistudiodesktop_net::{DialError, ErrorCode, Socket};

/// Gives the engine an open WebSocket to the daemon of the current entry, whenever it asks.
///
/// The app implements it: it reads the current entry and its password, and calls
/// [`net::dial`](pistudiodesktop_net::dial) with the message limit
/// [`Limits::max_message_bytes`](crate::Limits::max_message_bytes) (the engine refuses a socket that
/// does not carry it). A test implements it over the address of the stand-in daemon.
pub trait Connector: Send + Sync + 'static {
    /// Opens a socket, or says why it could not, and whether trying again can help.
    fn connect(&self) -> impl Future<Output = Result<Socket, ConnectError>> + Send;
}

/// A socket that could not be opened. `message` is written for a person and never holds a password.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConnectError {
    /// The code the page sees: a dial's (`unreachable`, `unauthorized`, `tls`, …) or the app's own
    /// (`secret_missing`, `no_current`, `not_bridged`, …).
    pub code: &'static str,
    /// The words for the user.
    pub message: String,
    /// Whether trying again can help: the daemon is not reachable yet, not that the password is
    /// wrong. The engine does not try again yet: it fails the transfers whichever it is.
    pub retry: bool,
}

impl ConnectError {
    /// An error with `code` and `message`.
    pub fn new(code: &'static str, message: impl Into<String>, retry: bool) -> Self {
        Self { code, message: message.into(), retry }
    }
}

impl From<DialError> for ConnectError {
    /// A dial that did not reach the daemon (`unreachable`, `timeout`, `handshake`) may succeed
    /// later; one the daemon or the address refused will not.
    fn from(error: DialError) -> Self {
        let retry = matches!(error.code, ErrorCode::Unreachable | ErrorCode::Timeout | ErrorCode::Handshake);
        Self { code: error.code.as_str(), message: error.message, retry }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_refused_address_is_not_retried() {
        let dial = pistudiodesktop_net::check_address("http://example.com").unwrap_err();
        let refused = ConnectError::from(dial);
        assert_eq!((refused.code, refused.retry), ("invalid_address", false));
    }

    #[test]
    fn only_unreachable_timeout_and_handshake_are_retried() {
        let retried: Vec<&str> =
            [ErrorCode::Unreachable, ErrorCode::Timeout, ErrorCode::Handshake, ErrorCode::Tls, ErrorCode::Unauthorized, ErrorCode::HostNotAllowed]
                .into_iter()
                .filter(|code| {
                    let dial = DialError { code: *code, message: String::new(), tls_reason: None };
                    ConnectError::from(dial).retry
                })
                .map(ErrorCode::as_str)
                .collect();
        assert_eq!(retried, ["unreachable", "timeout", "handshake"]);
    }
}
