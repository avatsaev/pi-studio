//! What the engine says about itself to the control socket (`ui.inspect` → `transfers`, spec § 8):
//! plain data, no path, no address, no handle and no secret.

use super::event::TransferState;

/// The bulk connection's state.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConnectionState {
    /// No connection: nothing needs one, or it was closed.
    Closed,
    /// It is being dialled and the daemon's `server_info` awaited.
    Connecting,
    /// It is open.
    Open,
}

impl ConnectionState {
    /// The state as the control socket reads it.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Closed => "closed",
            Self::Connecting => "connecting",
            Self::Open => "open",
        }
    }
}

/// What a transfer is.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    /// A file from this machine to the daemon.
    Upload,
    /// A file from the daemon to this machine.
    Save,
}

impl Kind {
    /// The kind as the control socket reads it.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Upload => "upload",
            Self::Save => "save",
        }
    }
}

/// The bulk connection.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ConnectionInfo {
    /// Where it is.
    pub state: ConnectionState,
    /// How often it was opened in this run of the engine.
    pub opens: u64,
}

/// A transfer that has left the queue.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ActiveTransfer {
    /// The caller's id.
    pub id: String,
    /// Upload or save.
    pub kind: Kind,
    /// [`Running`](TransferState::Running), or [`Waiting`](TransferState::Waiting) for the connection.
    pub state: TransferState,
    /// Bytes sent or written.
    pub done: u64,
    /// The file's size, when it is known.
    pub total: Option<u64>,
    /// How often the transfer continued after a lost connection. Always 0 until the engine
    /// reconnects.
    pub restarts: u32,
}

/// How the transfers that settled ended.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Totals {
    /// Completed.
    pub done: u64,
    /// Failed, with any code but `cancelled`.
    pub failed: u64,
    /// Cancelled.
    pub cancelled: u64,
}

/// The last transfer failure.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LastError {
    /// The failure's code.
    pub code: &'static str,
    /// When it happened: milliseconds since the Unix epoch, read from the engine's clock (tokio's) from
    /// the wall time at which the engine was made.
    pub at_ms: u64,
}

/// The engine's state at one moment.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Snapshot {
    /// The bulk connection.
    pub connection: ConnectionInfo,
    /// The transfers that are running or waiting for the connection, oldest first.
    pub active: Vec<ActiveTransfer>,
    /// How many transfers wait for their turn.
    pub queued: usize,
    /// How the settled transfers ended.
    pub totals: Totals,
    /// The most bytes the engine held in memory for transfers at one moment: the read buffer of each
    /// upload and the bytes of each download that the daemon sent and the disk has not taken.
    pub peak_held: u64,
    /// The last failure of a transfer, if there was one.
    pub last_error: Option<LastError>,
}
