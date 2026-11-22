//! How a save ended when it did not complete.

use super::Version;
use crate::error::Error;

/// Why a save did not complete. Each case is what the page's `transfer_save` reports as a code (see
/// [`SaveError::code`]), except [`ConnectionLost`](Self::ConnectionLost): that one is not the save's
/// failure but the connection's, and the engine decides whether to resume.
///
/// The messages may name the daemon's reason and the system's reason for a failed write; they never
/// hold a local path, a password or a handle.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum SaveError {
    /// The caller's cancel future completed first.
    #[error("The download was cancelled.")]
    Cancelled,
    /// The daemon says the file is not the one the save began with: it answered `changed` to a
    /// resume, or sent an `Error` frame `changed` (the file shrank while it was read). The save does
    /// not start again by itself (D13).
    #[error("The file changed on the daemon.")]
    Changed,
    /// The daemon answered `ok: false` (`not_found`, `not_a_file`, `unreadable`, `no_free_stream`, …),
    /// answered with an `rpc_error`, or sent an `Error` frame (`read_failed`, `cancelled`, …).
    /// `reason` is the daemon's own.
    #[error("The daemon refused the download: {reason}.")]
    DaemonRefused {
        /// The daemon's reason.
        reason: String,
    },
    /// Writing, or finishing, the sink failed. `reason` is the system's.
    #[error("The file could not be written: {reason}.")]
    Disk {
        /// The system's reason.
        reason: String,
    },
    /// The daemon broke the protocol: a frame out of order, more bytes than it announced, an answer
    /// of the wrong shape, a message above the limit. Holds [`Error::Protocol`].
    #[error(transparent)]
    Protocol(Error),
    /// The connection ended, or the daemon did not answer the request in time. The save is neither
    /// done nor refused: the sink was left as it is, to resume into. `version` is the file as the
    /// daemon's answer described it, when there was one (or the one the save was asked to resume),
    /// which is what the resume's `ifUnchanged` needs. Holds [`Error::Closed`] or [`Error::Timeout`].
    #[error("{reason}")]
    ConnectionLost {
        /// Why the connection ended.
        reason: Error,
        /// The file's size and modification time, when they are known.
        version: Option<Version>,
    },
    /// Something the engine did not expect. Never the daemon's or the sink's fault.
    #[error("The transfer engine met something it did not expect: {0}.")]
    Internal(&'static str),
}

impl SaveError {
    /// The code the page sees for this failure. A lost connection has none of the page's codes:
    /// the engine resumes it, and a resume that ends in a final error reports that one.
    #[must_use]
    pub fn code(&self) -> &'static str {
        match self {
            Self::Cancelled => "cancelled",
            Self::Changed => "changed",
            Self::DaemonRefused { .. } => "daemon_refused",
            Self::Disk { .. } => "disk",
            Self::Protocol(_) => "protocol",
            Self::ConnectionLost { .. } => "connection_lost",
            Self::Internal(_) => "internal",
        }
    }

    /// What an error of the connection means for a save that was using it. `version` is what the
    /// save knows of the file, for a resume.
    pub(super) fn from_connection(error: Error, version: Option<Version>) -> Self {
        match error {
            Error::Rpc { code, message } => Self::DaemonRefused { reason: format!("{message} ({code})") },
            Error::Protocol(_) => Self::Protocol(error),
            Error::Internal(what) => Self::Internal(what),
            Error::Closed(_) | Error::Timeout | Error::Dial(_) | Error::UnsupportedDaemon { .. } => Self::ConnectionLost { reason: error, version },
        }
    }

    /// The daemon broke the protocol, in these words (which never repeat what it sent).
    pub(super) fn protocol(text: &str) -> Self {
        Self::Protocol(Error::Protocol(text.to_owned()))
    }

    /// The daemon's `Error` frame or refusal says `reason`: `changed` is its own case.
    pub(super) fn refused(reason: &str) -> Self {
        if reason == "changed" { Self::Changed } else { Self::DaemonRefused { reason: reason.to_owned() } }
    }
}
