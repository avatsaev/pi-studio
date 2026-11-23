//! Where the engine gets its socket: from the caller, so that the crate knows nothing of the registry,
//! the address or the secret store.

use pistudiodesktop_net::{DaemonSocket, DialError, ErrorCode};

/// Gives the engine an open WebSocket to the daemon of the current entry, whenever it asks.
///
/// The app implements it: it reads the current entry and its secret, and opens the daemon as the
/// entry's kind says (a [`net::dial`](pistudiodesktop_net::dial), or a relay's channel) with the
/// message limit [`Limits::max_message_bytes`](crate::Limits::max_message_bytes) (the engine refuses
/// a socket that does not carry it). A test implements it over the address of the stand-in daemon.
pub trait Connector: Send + Sync + 'static {
    /// Opens a socket, or says why it could not, and whether trying again can help.
    fn connect(&self) -> impl Future<Output = Result<DaemonSocket, ConnectError>> + Send;
}

/// The codes that fail every transfer at once, whatever a connector says about retrying: the password
/// or the daemon's key, the address, the link, the certificate, the host key, the app's own state and
/// the daemon's version do not mend by waiting (spec § The connection and its recovery, and
/// `desktop-relay-ssh.md` § What the engine retries). Every other code is retried, `handshake`
/// included (S9).
pub const FINAL_CODES: [&str; 21] = [
    "unauthorized",
    "host_not_allowed",
    "tls",
    "invalid_address",
    "secret_missing",
    "secret_unavailable",
    "no_current",
    "unsupported",
    "unsupported_daemon",
    "protocol",
    // The relay's reasons that no retry mends, and a link that does not parse.
    "wrong_key",
    "daemon_outdated",
    "protocol_error",
    "invalid_link",
    // An SSH entry's: every login refused, a host key to trust or that changed, a key that needs a
    // passphrase or cannot be read, a server that forbids forwarding, a config that does not parse.
    "auth_failed",
    "host_key_unknown",
    "host_key_changed",
    "passphrase_needed",
    "key_unreadable",
    "forwarding_refused",
    "ssh_config",
];

/// A socket that could not be opened. `message` is written for a person and never holds a password.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConnectError {
    /// The code the page sees: a dial's (`unreachable`, `unauthorized`, `tls`, …), a relay's
    /// (`daemon_offline`, `wrong_key`, …) or the app's own (`secret_missing`, `no_current`, …).
    pub code: &'static str,
    /// The words for the user.
    pub message: String,
    /// Whether trying again can help: the daemon is not reachable yet, not that the password is
    /// wrong. `false` is final: the engine fails every transfer with this error at once. `true` is
    /// retried unless the `code` is one of [`FINAL_CODES`], which no retry can fix.
    pub retry: bool,
}

impl ConnectError {
    /// An error with `code` and `message`.
    pub fn new(code: &'static str, message: impl Into<String>, retry: bool) -> Self {
        Self { code, message: message.into(), retry }
    }

    /// Whether the engine tries again after this error: the connector allows it and the code is not final.
    pub(super) fn retried(&self) -> bool {
        self.retry && !FINAL_CODES.contains(&self.code)
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
