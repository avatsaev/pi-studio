//! Why a dial failed: a code the connection bar can branch on and a message a person can read.

use std::fmt;

/// The error codes of `transport_open` that the daemon's leg can produce. [`ErrorCode::as_str`] is
/// the string the page sees; it never changes once released.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ErrorCode {
    /// The address is not a `ws` or `wss` address, has user information or a password that a
    /// subprotocol cannot carry. Raised before any network use.
    InvalidAddress,
    /// The name did not resolve, the connection was refused, or there is no route.
    Unreachable,
    /// The certificate was refused, or the TLS handshake did not complete. See [`TlsReason`].
    Tls,
    /// The upgrade was answered 401: the password is wrong or missing.
    Unauthorized,
    /// The upgrade was answered 403: the daemon does not accept this `Host`
    /// (`PI_STUDIO_HOSTNAMES`).
    HostNotAllowed,
    /// Any other answer to the upgrade.
    Handshake,
    /// The time limit passed.
    Timeout,
}

impl ErrorCode {
    /// The code as the page reads it.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::InvalidAddress => "invalid_address",
            Self::Unreachable => "unreachable",
            Self::Tls => "tls",
            Self::Unauthorized => "unauthorized",
            Self::HostNotAllowed => "host_not_allowed",
            Self::Handshake => "handshake",
            Self::Timeout => "timeout",
        }
    }
}

/// Why the daemon's certificate was refused.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TlsReason {
    /// The certificate's validity ended.
    Expired,
    /// The certificate's validity has not begun: usually this machine's clock is wrong.
    NotYetValid,
    /// The issuer is not trusted by the operating system's certificate store.
    UnknownIssuer,
    /// The certificate is not valid for the host the app dialled.
    WrongName,
    /// The certificate was revoked.
    Revoked,
    /// Anything else: a bad signature, a certificate meant for another purpose, and so on.
    Other,
}

impl TlsReason {
    /// The reason as a clause that completes "The certificate …".
    #[must_use]
    pub const fn phrase(self) -> &'static str {
        match self {
            Self::Expired => "has expired",
            Self::NotYetValid => "is not valid yet (is this machine's clock right?)",
            Self::UnknownIssuer => "was issued by an authority this system does not trust",
            Self::WrongName => "is not valid for this host name or address",
            Self::Revoked => "has been revoked",
            Self::Other => "was refused",
        }
    }
}

/// A dial that did not give an open WebSocket.
///
/// `message` is written for a person: it names the host and port, says what would be right where
/// the app can tell, and never holds the password (nor the URL, which a caller may have built
/// with one).
#[derive(Clone, PartialEq, Eq)]
pub struct DialError {
    pub code: ErrorCode,
    pub message: String,
    /// Set when `code` is [`ErrorCode::Tls`] and the certificate was refused.
    pub tls_reason: Option<TlsReason>,
}

impl DialError {
    pub(crate) fn new(code: ErrorCode, message: impl Into<String>) -> Self {
        Self { code, message: message.into(), tls_reason: None }
    }

    pub(crate) fn tls(reason: TlsReason, message: impl Into<String>) -> Self {
        Self { code: ErrorCode::Tls, message: message.into(), tls_reason: Some(reason) }
    }
}

impl fmt::Debug for DialError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("DialError").field("code", &self.code.as_str()).field("message", &self.message).finish()
    }
}

impl fmt::Display for DialError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}: {}", self.code.as_str(), self.message)
    }
}

impl std::error::Error for DialError {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn codes_are_the_names_the_page_reads() {
        let all = [
            (ErrorCode::InvalidAddress, "invalid_address"),
            (ErrorCode::Unreachable, "unreachable"),
            (ErrorCode::Tls, "tls"),
            (ErrorCode::Unauthorized, "unauthorized"),
            (ErrorCode::HostNotAllowed, "host_not_allowed"),
            (ErrorCode::Handshake, "handshake"),
            (ErrorCode::Timeout, "timeout"),
        ];
        for (code, name) in all {
            assert_eq!(code.as_str(), name);
        }
    }

    #[test]
    fn display_and_debug_carry_code_and_message() {
        let e = DialError::new(ErrorCode::Unreachable, "Cannot reach 127.0.0.1:9");
        assert_eq!(e.to_string(), "unreachable: Cannot reach 127.0.0.1:9");
        assert!(format!("{e:?}").contains("unreachable"));
    }
}
