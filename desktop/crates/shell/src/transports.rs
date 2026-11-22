//! The proxied daemon connections as `ui.inspect` shows them (`connection.transports` and
//! `connection.lastError`): plain data the app's hook fills in ([`crate::Services::transports`]).
//! The sockets are in the app binary; this module holds no socket type and, by construction, no
//! address, token or message: a code, an entry id, a state and counters.

use serde::Serialize;

/// Where a proxied connection is in its life.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum TransportState {
    /// From `transport_open` until the page's upgrade is accepted.
    Connecting,
    /// The pump runs.
    Open,
    /// A close handshake is in progress.
    Closing,
}

/// One proxied connection. "In" is what went from the daemon to the page.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransportView {
    /// The registry entry the connection was opened for.
    pub entry_id: String,
    pub state: TransportState,
    pub frames_in: u64,
    pub frames_out: u64,
    pub bytes_in: u64,
    pub bytes_out: u64,
    /// The most payload bytes held at once in each direction.
    pub peak_held_in: u64,
    pub peak_held_out: u64,
}

/// The last failed `transport_open` or abnormal end of a connection.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionError {
    /// A fixed code (`unreachable`, `page_refused`, …): never a message.
    pub code: &'static str,
    /// Milliseconds since the Unix epoch.
    pub at_ms: u64,
}

impl ConnectionError {
    /// The one that happened later; `self` when both happened at the same millisecond.
    #[must_use]
    pub const fn or_newer(self, other: Option<Self>) -> Self {
        match other {
            Some(other) if other.at_ms > self.at_ms => other,
            _ => self,
        }
    }
}

/// What the hook answers: the live connections and the last error.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Snapshot {
    pub transports: Vec<TransportView>,
    pub last_error: Option<ConnectionError>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const A: ConnectionError = ConnectionError { code: "unreachable", at_ms: 10 };
    const B: ConnectionError = ConnectionError { code: "page_refused", at_ms: 20 };

    #[test]
    fn the_view_is_camel_case_with_a_lowercase_state() {
        let view = TransportView {
            entry_id: "e1".into(),
            state: TransportState::Connecting,
            frames_in: 1,
            frames_out: 2,
            bytes_in: 3,
            bytes_out: 4,
            peak_held_in: 5,
            peak_held_out: 6,
        };
        assert_eq!(
            serde_json::to_value(&view).ok(),
            Some(
                json!({"entryId": "e1", "state": "connecting", "framesIn": 1, "framesOut": 2, "bytesIn": 3, "bytesOut": 4, "peakHeldIn": 5, "peakHeldOut": 6})
            )
        );
        assert_eq!(serde_json::to_value(TransportState::Closing).ok(), Some(json!("closing")));
        assert_eq!(serde_json::to_value(A).ok(), Some(json!({"code": "unreachable", "atMs": 10})));
    }

    #[test]
    fn the_newer_error_wins_and_a_tie_keeps_the_first() {
        assert_eq!(A.or_newer(Some(B)), B);
        assert_eq!(B.or_newer(Some(A)), B);
        assert_eq!(A.or_newer(None), A);
        let same = ConnectionError { code: "limit", at_ms: 10 };
        assert_eq!(A.or_newer(Some(same)), A);
    }
}
