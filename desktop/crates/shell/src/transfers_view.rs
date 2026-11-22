//! The `transfers` section of `ui.inspect`: plain data the app's hook fills in
//! ([`crate::Services::transfers`]). By construction it has no field a path, an address, a handle
//! or a secret could sit in: ids, fixed words, counters and a fixed error code.

use crate::transfer_mode::TransfersMode;
use crate::transports::ConnectionError;
use serde::Serialize;

/// Where the bulk connection is in its life.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum BulkState {
    #[default]
    Closed,
    Connecting,
    Open,
    Waiting,
}

/// What a transfer does.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum TransferKind {
    Upload,
    Save,
}

/// Whether bytes move now.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ActiveState {
    Running,
    Waiting,
}

/// The bulk connection. `opens` counts how often it was opened in this run.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BulkView {
    pub state: BulkState,
    pub entry_id: Option<String>,
    pub opens: u64,
}

/// One transfer that is not queued. `restarts` counts how often it continued after a drop.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActiveView {
    pub id: String,
    pub kind: TransferKind,
    pub state: ActiveState,
    pub bytes_done: u64,
    pub bytes_total: Option<u64>,
    pub restarts: u64,
}

/// Transfers settled in this run.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize)]
pub struct Totals {
    pub done: u64,
    pub failed: u64,
    pub cancelled: u64,
}

/// What the hook answers. The launch mode is not in it: the shell adds it.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub connection: BulkView,
    pub active: Vec<ActiveView>,
    pub queued: u64,
    pub totals: Totals,
    /// The most bytes the engine held for transfers, in memory, at one moment.
    pub peak_held: u64,
    pub last_error: Option<ConnectionError>,
}

/// The section as `ui.inspect` shows it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransfersView {
    pub mode: &'static str,
    #[serde(flatten)]
    pub snapshot: Snapshot,
}

impl TransfersView {
    #[must_use]
    pub fn new(mode: TransfersMode, snapshot: Snapshot) -> Self {
        Self { mode: mode.as_str(), snapshot }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn the_empty_view_is_a_closed_connection_and_zeros() {
        let view = TransfersView::new(TransfersMode::Page, Snapshot::default());
        assert_eq!(
            serde_json::to_value(&view).ok(),
            Some(json!({
                "mode": "page",
                "connection": {"state": "closed", "entryId": null, "opens": 0},
                "active": [],
                "queued": 0,
                "totals": {"done": 0, "failed": 0, "cancelled": 0},
                "peakHeld": 0,
                "lastError": null
            }))
        );
    }

    #[test]
    fn a_filled_view_is_camel_case_with_lowercase_words() {
        let snapshot = Snapshot {
            connection: BulkView { state: BulkState::Waiting, entry_id: Some("e1".into()), opens: 2 },
            active: vec![ActiveView { id: "t1".into(), kind: TransferKind::Save, state: ActiveState::Running, bytes_done: 5, bytes_total: None, restarts: 1 }],
            queued: 4,
            totals: Totals { done: 1, failed: 2, cancelled: 3 },
            peak_held: 99,
            last_error: Some(ConnectionError { code: "unreachable", at_ms: 7 }),
        };
        let seen = serde_json::to_value(TransfersView::new(TransfersMode::Engine, snapshot)).unwrap_or_default();
        assert_eq!(seen["mode"], "engine");
        assert_eq!(seen["connection"], json!({"state": "waiting", "entryId": "e1", "opens": 2}));
        assert_eq!(seen["active"], json!([{"id": "t1", "kind": "save", "state": "running", "bytesDone": 5, "bytesTotal": null, "restarts": 1}]));
        assert_eq!((seen["queued"].clone(), seen["peakHeld"].clone()), (json!(4), json!(99)));
        assert_eq!(seen["totals"], json!({"done": 1, "failed": 2, "cancelled": 3}));
        assert_eq!(seen["lastError"], json!({"code": "unreachable", "atMs": 7}));
    }
}
