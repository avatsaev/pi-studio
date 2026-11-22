//! How an upload ended when it did not complete.

use crate::error::Error;

/// Why an upload did not complete. Each case is what the page's `transfer_upload` reports as a
/// code (see [`UploadError::code`]), except [`ConnectionLost`](Self::ConnectionLost): that one is not
/// the upload's failure but the connection's, and the engine decides whether to start again.
///
/// The messages may name the daemon's reason and the system's reason for an unreadable source; they
/// never hold a local path, a password or a handle.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum UploadError {
    /// The caller's cancel future completed first.
    #[error("The upload was cancelled.")]
    Cancelled,
    /// The daemon refused the request (`ok: false`, an `rpc_error`) or reported a failed write in
    /// `file_upload_complete`. `reason` is the daemon's own (`no_free_stream`, `write_failed (ENOSPC)`, …).
    #[error("The daemon refused the upload: {reason}.")]
    DaemonRefused {
        /// The daemon's reason.
        reason: String,
    },
    /// The source could not be read. `reason` is the system's.
    #[error("The file could not be read: {reason}.")]
    SourceUnreadable {
        /// The system's reason.
        reason: String,
    },
    /// The source gave more or fewer bytes than the size it reported when the upload began.
    #[error("The file changed while it was being uploaded.")]
    SourceChanged,
    /// The daemon wrote another number of bytes than were sent.
    #[error("The daemon wrote {reported} bytes of the {sent} that were sent.")]
    SizeMismatch {
        /// The bytes the engine sent.
        sent: u64,
        /// The bytes `file_upload_complete` reported.
        reported: u64,
    },
    /// The daemon broke the protocol: an answer of the wrong shape, or a push for another stream.
    #[error(transparent)]
    Protocol(Error),
    /// The connection ended, or the daemon did not answer the request in time. The upload is
    /// neither done nor refused: the daemon's temporary file is gone with its session, and the
    /// engine may start again from zero on another connection. Holds [`Error::Closed`] or
    /// [`Error::Timeout`].
    #[error(transparent)]
    ConnectionLost(Error),
    /// Something the engine did not expect. Never the daemon's or the source's fault.
    #[error("The transfer engine met something it did not expect: {0}.")]
    Internal(&'static str),
}

impl UploadError {
    /// The code the page sees for this failure. A lost connection has none of the page's codes:
    /// the engine retries it, and a retry that ends in a final error reports that one.
    #[must_use]
    pub fn code(&self) -> &'static str {
        match self {
            Self::Cancelled => "cancelled",
            Self::DaemonRefused { .. } => "daemon_refused",
            Self::SourceUnreadable { .. } => "source_unreadable",
            Self::SourceChanged => "source_changed",
            Self::SizeMismatch { .. } => "size_mismatch",
            Self::Protocol(_) => "protocol",
            Self::ConnectionLost(_) => "connection_lost",
            Self::Internal(_) => "internal",
        }
    }
}

impl From<Error> for UploadError {
    /// What an error of the connection means for an upload that was using it.
    fn from(error: Error) -> Self {
        match error {
            Error::Rpc { code, message } => Self::DaemonRefused { reason: format!("{message} ({code})") },
            Error::Protocol(_) => Self::Protocol(error),
            Error::Internal(what) => Self::Internal(what),
            Error::Closed(_) | Error::Timeout | Error::Dial(_) | Error::UnsupportedDaemon { .. } => Self::ConnectionLost(error),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::Ended;

    #[test]
    fn every_failure_has_its_code_and_a_message_with_its_reason() {
        let cases = [
            (UploadError::Cancelled, "cancelled", "cancelled"),
            (UploadError::DaemonRefused { reason: "not_found".into() }, "daemon_refused", "not_found"),
            (UploadError::SourceUnreadable { reason: "Permission denied (os error 13)".into() }, "source_unreadable", "Permission denied"),
            (UploadError::SourceChanged, "source_changed", "changed"),
            (UploadError::SizeMismatch { sent: 10, reported: 7 }, "size_mismatch", "7 bytes of the 10"),
            (UploadError::Protocol(Error::Protocol("a frame out of order".into())), "protocol", "out of order"),
            (UploadError::ConnectionLost(Error::Closed(Ended::Socket)), "connection_lost", "network connection failed"),
            (UploadError::Internal("a thing"), "internal", "a thing"),
        ];
        for (error, code, words) in cases {
            assert_eq!(error.code(), code);
            assert!(error.to_string().contains(words), "{error}");
        }
    }

    #[test]
    fn a_connection_error_is_sorted_by_what_it_means_for_an_upload() {
        assert_eq!(
            UploadError::from(Error::Rpc { code: "handler_error".into(), message: "no space".into() }),
            UploadError::DaemonRefused { reason: "no space (handler_error)".into() }
        );
        assert!(matches!(UploadError::from(Error::Protocol("x".into())), UploadError::Protocol(_)));
        assert_eq!(UploadError::from(Error::Internal("y")), UploadError::Internal("y"));
        assert_eq!(UploadError::from(Error::Timeout), UploadError::ConnectionLost(Error::Timeout));
        assert_eq!(UploadError::from(Error::Closed(Ended::Silent)), UploadError::ConnectionLost(Error::Closed(Ended::Silent)));
    }
}
