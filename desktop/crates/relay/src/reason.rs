//! Why a relay connect failed: the SDK's eight reasons and its messages (`RelayConnectError` in
//! `packages/client/src/relay-transport.ts`), so that the page shows the same text whichever side ran the
//! connect.

use std::fmt;

/// The longest detail a message carries, in characters: a close reason is at most 123 bytes.
const MAX_DETAIL_CHARS: usize = 128;

/// The cause of a failed connect. [`RelayReason::as_str`] is the string the page reads (the SDK's
/// `RelayConnectReason`); it never changes once released.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RelayReason {
    /// The relay closed 4102: no control socket for the daemon's session id.
    DaemonOffline,
    /// The relay closed 4103: the daemon did not attach within 10 s.
    DaemonUnresponsive,
    /// The relay closed 4104: the session id already has 32 connections.
    TooManyClients,
    /// The relay closed 4105: a silent daemon of the older protocol is parked under the session id.
    DaemonOutdated,
    /// The connect did not finish within its limit.
    Timeout,
    /// The `ready` frame did not open, or the relay closed 4200 after pairing: the link's key is not
    /// the daemon's.
    WrongKey,
    /// The relay could not be dialled, or closed without a close code before it paired.
    RelayUnreachable,
    /// Anything else before the channel opened.
    ProtocolError,
}

impl RelayReason {
    /// The reason as the page reads it.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::DaemonOffline => "daemon_offline",
            Self::DaemonUnresponsive => "daemon_unresponsive",
            Self::TooManyClients => "too_many_clients",
            Self::DaemonOutdated => "daemon_outdated",
            Self::Timeout => "timeout",
            Self::WrongKey => "wrong_key",
            Self::RelayUnreachable => "relay_unreachable",
            Self::ProtocolError => "protocol_error",
        }
    }

    /// What to tell a person, as the SDK's `REASON_MESSAGES` do.
    #[must_use]
    pub const fn message(self) -> &'static str {
        match self {
            Self::DaemonOffline => "The daemon is not connected to the relay: it may be offline, or its key replaced, so this pairing link is no longer valid.",
            Self::DaemonUnresponsive => "The daemon did not answer through the relay.",
            Self::TooManyClients => "The daemon already has the maximum number of relay connections.",
            Self::DaemonOutdated => "The daemon speaks an older relay protocol and must be updated.",
            Self::Timeout => "The relay did not answer in time; a self-hosted relay may need updating.",
            Self::WrongKey => "The pairing link does not match this daemon.",
            Self::RelayUnreachable => "The relay could not be reached.",
            Self::ProtocolError => "The relay connection failed with a protocol error.",
        }
    }
}

/// A connect that did not give an open channel. `message` is the reason's text, with a detail in
/// parentheses where there is one, as the SDK writes it; it never holds the pairing link or the key.
#[derive(Clone, PartialEq, Eq)]
pub struct RelayError {
    pub reason: RelayReason,
    pub message: String,
}

impl RelayError {
    /// An error with the reason's own text.
    #[must_use]
    pub fn new(reason: RelayReason) -> Self {
        Self { reason, message: reason.message().to_owned() }
    }

    /// An error with a detail from outside (a close reason, a dial's message): the detail loses control
    /// characters and is cut to [`MAX_DETAIL_CHARS`], and an empty one is left out.
    #[must_use]
    pub fn with_detail(reason: RelayReason, detail: &str) -> Self {
        let detail: String = detail.chars().filter(|c| !c.is_control()).take(MAX_DETAIL_CHARS).collect();
        let detail = detail.trim();
        if detail.is_empty() { Self::new(reason) } else { Self { reason, message: format!("{} ({detail})", reason.message()) } }
    }
}

impl fmt::Debug for RelayError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("RelayError").field("reason", &self.reason.as_str()).field("message", &self.message).finish()
    }
}

impl fmt::Display for RelayError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}: {}", self.reason.as_str(), self.message)
    }
}

impl std::error::Error for RelayError {}

#[cfg(test)]
mod tests {
    use super::*;

    const ALL: [(RelayReason, &str); 8] = [
        (RelayReason::DaemonOffline, "daemon_offline"),
        (RelayReason::DaemonUnresponsive, "daemon_unresponsive"),
        (RelayReason::TooManyClients, "too_many_clients"),
        (RelayReason::DaemonOutdated, "daemon_outdated"),
        (RelayReason::Timeout, "timeout"),
        (RelayReason::WrongKey, "wrong_key"),
        (RelayReason::RelayUnreachable, "relay_unreachable"),
        (RelayReason::ProtocolError, "protocol_error"),
    ];

    #[test]
    fn reasons_are_the_names_the_sdk_reads() {
        for (reason, name) in ALL {
            assert_eq!(reason.as_str(), name);
            assert!(!reason.message().is_empty());
        }
    }

    /// The texts are the SDK's `REASON_MESSAGES`, read from its source so that a change there fails here.
    #[test]
    fn messages_are_the_sdks() {
        let source = include_str!("../../../../packages/client/src/relay-transport.ts");
        for (reason, name) in ALL {
            let key = format!("  {name}:");
            let start = source.find(&key).unwrap_or_else(|| panic!("{name} is not in the SDK"));
            let tail = &source[start + key.len()..];
            let end = tail.find("\",\n").unwrap_or_else(|| panic!("{name}'s text does not end"));
            let text = tail[..end].trim().trim_start_matches('"');
            assert_eq!(reason.message(), text, "{name}");
        }
    }

    #[test]
    fn a_detail_follows_the_message_in_parentheses() {
        let error = RelayError::with_detail(RelayReason::ProtocolError, "protocol_error");
        assert_eq!(error.message, "The relay connection failed with a protocol error. (protocol_error)");
        assert_eq!(error.to_string(), format!("protocol_error: {}", error.message));
    }

    #[test]
    fn an_empty_detail_is_left_out_and_a_hostile_one_is_cleaned() {
        assert_eq!(RelayError::with_detail(RelayReason::WrongKey, "  ").message, RelayReason::WrongKey.message());
        let hostile = format!("a\u{0}b\n{}", "x".repeat(10_000));
        let error = RelayError::with_detail(RelayReason::WrongKey, &hostile);
        assert!(!error.message.chars().any(char::is_control));
        assert!(error.message.len() < RelayReason::WrongKey.message().len() + MAX_DETAIL_CHARS + 8);
    }
}
