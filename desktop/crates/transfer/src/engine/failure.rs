//! How a transfer that did not complete is reported: a code the page branches on and a message a person reads.

use super::connector::ConnectError;
use crate::download::SaveError;
use crate::error::Error;
use crate::upload::UploadError;

/// Why a transfer did not complete, as `{ code, message }` (spec § Error handling).
///
/// `code` is one of `cancelled`, `invalid_request`, `duplicate_id`, `source_unreadable`,
/// `source_changed`, `disk`, `changed`, `daemon_refused`, `size_mismatch`, `protocol`,
/// `unsupported_daemon`, `internal`, a code of the dial (`unreachable`, `timeout`, `unauthorized`,
/// `tls`, …) or one the connector gives, and `connection_lost`: the bulk connection ended, or would
/// not open, with no code of its own to give. `message` is written for a person: it may name the
/// daemon's host and the daemon's or the system's reason, and never a local path, a password or a handle.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("{message}")]
pub struct Failure {
    /// The code the page sees.
    pub code: &'static str,
    /// The words for the user.
    pub message: String,
}

impl Failure {
    /// A failure with `code` and `message`.
    pub fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self { code, message: message.into() }
    }

    /// The transfer was cancelled.
    #[must_use]
    pub fn cancelled() -> Self {
        Self::new("cancelled", "The transfer was cancelled.")
    }

    /// Something the engine did not expect.
    #[must_use]
    pub fn internal(what: &str) -> Self {
        Self::new("internal", format!("The transfer engine met something it did not expect: {what}."))
    }

    /// An id or a path the engine does not accept.
    pub(super) fn invalid_request(what: &str) -> Self {
        Self::new("invalid_request", format!("The transfer was refused: {what}."))
    }

    /// An id that a transfer in the queue or running already has.
    pub(super) fn duplicate_id() -> Self {
        Self::new("duplicate_id", "A transfer with this id is already running or waiting.")
    }
}

impl From<UploadError> for Failure {
    fn from(error: UploadError) -> Self {
        Self::new(error.code(), error.to_string())
    }
}

impl From<SaveError> for Failure {
    fn from(error: SaveError) -> Self {
        Self::new(error.code(), error.to_string())
    }
}

impl From<ConnectError> for Failure {
    fn from(error: ConnectError) -> Self {
        Self::new(error.code, error.message)
    }
}

impl From<Error> for Failure {
    /// What an error of the connection, opening or in use, means for the transfers that needed it.
    fn from(error: Error) -> Self {
        let code = match &error {
            Error::Dial(dial) => dial.code.as_str(),
            Error::UnsupportedDaemon { .. } => "unsupported_daemon",
            Error::Protocol(_) => "protocol",
            Error::Timeout => "timeout",
            Error::Rpc { .. } => "daemon_refused",
            Error::Closed(_) => "connection_lost",
            Error::Internal(_) => "internal",
        };
        Self::new(code, error.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::Ended;

    #[test]
    fn an_upload_error_keeps_its_code_and_words() {
        let failure = Failure::from(UploadError::SourceChanged);
        assert_eq!(failure.code, "source_changed");
        assert_eq!(failure.message, "The file changed while it was being uploaded.");
    }

    #[test]
    fn a_save_error_keeps_its_code_and_words() {
        let failure = Failure::from(SaveError::Changed);
        assert_eq!((failure.code, failure.message.as_str()), ("changed", "The file changed on the daemon."));
    }

    #[test]
    fn a_connection_error_maps_to_the_codes_of_the_spec() {
        for (error, code) in [
            (Error::UnsupportedDaemon { missing: "fileTransferAck" }, "unsupported_daemon"),
            (Error::Protocol("x".into()), "protocol"),
            (Error::Timeout, "timeout"),
            (Error::Closed(Ended::Socket), "connection_lost"),
            (Error::Internal("x"), "internal"),
        ] {
            assert_eq!(Failure::from(error).code, code);
        }
    }

    #[test]
    fn a_dial_error_keeps_the_dials_code() {
        let dial = pistudiodesktop_net::check_address("http://example.com").unwrap_err();
        assert_eq!(Failure::from(Error::Dial(dial)).code, "invalid_address");
    }

    #[test]
    fn the_fixed_failures_say_what_happened() {
        assert_eq!(Failure::cancelled().code, "cancelled");
        assert_eq!(Failure::duplicate_id().code, "duplicate_id");
        assert!(Failure::invalid_request("the id is empty").message.contains("the id is empty"));
        assert_eq!(Failure::internal("x").code, "internal");
    }
}
