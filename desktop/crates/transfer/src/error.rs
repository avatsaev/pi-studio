//! Why a transfer, or the connection it runs on, did not work.

use pistudiodesktop_net::DialError;

/// How a connection that was open came to an end. The reason every waiter on the connection is told.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Ended {
    /// This side closed it, or dropped the handle without closing.
    Local,
    /// The daemon closed it: its close code, when it sent a close frame with one.
    Remote(Option<u16>),
    /// No frame came from the daemon for the dropped time, or one write did not finish in that time.
    Silent,
    /// The socket failed: a reset, a refused write, an end with no close frame.
    Socket,
}

impl std::fmt::Display for Ended {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Local => f.write_str("it was closed here"),
            Self::Remote(Some(code)) => write!(f, "the daemon closed it (code {code})"),
            Self::Remote(None) => f.write_str("the daemon closed it"),
            Self::Silent => f.write_str("the daemon sent nothing for too long"),
            Self::Socket => f.write_str("the network connection failed"),
        }
    }
}

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
    /// The daemon answered a request with an `rpc_error`. `message` is its own wording.
    #[error("The daemon refused the request: {message} ({code})")]
    Rpc {
        /// The daemon's error code (`handler_error`, `unknown_message_type`, …).
        code: String,
        /// The daemon's words.
        message: String,
    },
    /// The connection ended while a transfer used it.
    #[error("The connection to the daemon ended: {0}.")]
    Closed(Ended),
    /// Something the engine did not expect, such as a socket that does not have the message limit.
    /// A fault of the app's own, never of the daemon's.
    #[error("The transfer engine met something it did not expect: {0}.")]
    Internal(&'static str),
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
        let refused = Error::Rpc { code: "handler_error".into(), message: "no such file".into() }.to_string();
        assert!(refused.contains("no such file") && refused.contains("handler_error"));
        assert!(Error::Internal("a stream id is taken").to_string().contains("a stream id is taken"));
    }

    #[test]
    fn a_closed_connection_says_how_it_ended() {
        for (ended, words) in [
            (Ended::Local, "closed here"),
            (Ended::Remote(Some(1011)), "code 1011"),
            (Ended::Remote(None), "the daemon closed it"),
            (Ended::Silent, "nothing for too long"),
            (Ended::Socket, "network connection failed"),
        ] {
            let text = Error::Closed(ended).to_string();
            assert!(text.contains(words), "{text}");
            assert!(text.starts_with("The connection to the daemon ended"), "{text}");
        }
    }
}
