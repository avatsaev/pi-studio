//! Why a transfer, or the connection it runs on, did not work.

use pistudiodesktop_net::DialError;

/// What stopped the engine. The messages are written for a person: they may name the daemon's
/// host, never a local path, a password or a handle.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum Error {
    /// The daemon could not be reached or refused the upgrade; the dial says which.
    #[error(transparent)]
    Dial(#[from] DialError),
    /// The daemon's `server_info` does not list a feature the engine needs.
    #[error("The daemon does not support what file transfers need: {missing}. Update the daemon.")]
    UnsupportedDaemon {
        /// The feature flag that is missing.
        missing: &'static str,
    },
    /// The daemon sent something the protocol does not allow.
    #[error("The daemon broke the protocol: {0}")]
    Protocol(String),
    /// An answer did not come within its time.
    #[error("The daemon did not answer in time.")]
    Timeout,
    /// The connection ended while a transfer used it.
    #[error("The connection to the daemon ended.")]
    Closed,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_dial_error_converts_and_keeps_its_text() {
        let dial = pistudiodesktop_net::check_address("http://example.com").unwrap_err();
        let text = dial.to_string();
        let error = Error::from(dial);
        assert!(matches!(error, Error::Dial(_)));
        assert_eq!(error.to_string(), text);
    }

    #[test]
    fn the_messages_name_the_cause() {
        assert!(Error::UnsupportedDaemon { missing: "fileDownloadRanges" }.to_string().contains("fileDownloadRanges"));
        assert!(Error::Protocol("a binary frame without a stream".into()).to_string().contains("a binary frame without a stream"));
        assert!(!Error::Timeout.to_string().is_empty());
        assert!(!Error::Closed.to_string().is_empty());
    }
}
