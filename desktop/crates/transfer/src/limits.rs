//! Every limit of the engine, in one place.
//!
//! The constants are the shipped values: chosen, not measured (`swe/features/desktop-transfer-engine.md`
//! S3 and D7). The engine takes them as a [`Limits`], so that a test can shorten a time or lower a
//! cap without touching what ships.

use std::time::Duration;

/// The connection closes (1000) after this long with no transfer running or waiting.
pub const IDLE_CLOSE: Duration = Duration::from_secs(30);

/// After this long without a frame from the daemon, the engine sends a `ping`.
pub const PING_AFTER: Duration = Duration::from_secs(10);

/// After this long without a frame from the daemon, the connection counts as dropped.
pub const DROPPED_AFTER: Duration = Duration::from_secs(30);

/// The first wait before a reconnect.
pub const BACKOFF_START: Duration = Duration::from_secs(1);

/// The longest wait before a reconnect: the wait doubles from [`BACKOFF_START`] up to this.
pub const BACKOFF_MAX: Duration = Duration::from_secs(30);

/// How long an answer (`server_info`, an RPC's reply) is awaited.
pub const ANSWER_WAIT: Duration = Duration::from_secs(30);

/// After one side has started a close (1000 or 1001), how long the other has to finish it: the
/// proxy's own close wait, so that both legs of the app give up together.
pub const CLOSE_WAIT: Duration = pistudiodesktop_net::limits::CLOSE_WAIT;

/// The largest message the connection's socket accepts: 16 MiB. The WebSocket library enforces it
/// while it reads, so a hostile length field cannot make the engine reserve memory for it.
pub const MAX_MESSAGE_BYTES: usize = 16 * 1024 * 1024;

/// A download stops reading the socket while more than this much of it is not yet on disk: 1 MiB.
pub const DOWNLOAD_HOLD_BYTES: usize = 1024 * 1024;

/// Transfers that move at once on the one connection; the rest wait in order.
pub const MAX_TRANSFERS: usize = 3;

/// The most bytes of a file one upload `Chunk` carries: 32 KiB.
pub const CHUNK_BYTES: usize = 32 * 1024;

/// The limits of one engine. [`Limits::default`] is what ships.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Limits {
    /// How long the connection stays open with nothing to do.
    pub idle_close: Duration,
    /// How long the daemon may be silent before a `ping`.
    pub ping_after: Duration,
    /// How long the daemon may be silent before the connection counts as dropped.
    pub dropped_after: Duration,
    /// The first wait before a reconnect.
    pub backoff_start: Duration,
    /// The longest wait before a reconnect.
    pub backoff_max: Duration,
    /// How long an answer is awaited.
    pub answer_wait: Duration,
    /// How long a close handshake may take.
    pub close_wait: Duration,
    /// The socket's message limit.
    pub max_message_bytes: usize,
    /// How much of a download may wait to be written to disk.
    pub download_hold_bytes: usize,
    /// Transfers that run at once.
    pub max_transfers: usize,
    /// The bytes of one upload `Chunk`.
    pub chunk_bytes: usize,
}

impl Default for Limits {
    fn default() -> Self {
        Self {
            idle_close: IDLE_CLOSE,
            ping_after: PING_AFTER,
            dropped_after: DROPPED_AFTER,
            backoff_start: BACKOFF_START,
            backoff_max: BACKOFF_MAX,
            answer_wait: ANSWER_WAIT,
            close_wait: CLOSE_WAIT,
            max_message_bytes: MAX_MESSAGE_BYTES,
            download_hold_bytes: DOWNLOAD_HOLD_BYTES,
            max_transfers: MAX_TRANSFERS,
            chunk_bytes: CHUNK_BYTES,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_defaults_are_the_shipped_values() {
        let limits = Limits::default();
        assert_eq!(limits.idle_close, Duration::from_secs(30));
        assert_eq!(limits.ping_after, Duration::from_secs(10));
        assert_eq!(limits.dropped_after, Duration::from_secs(30));
        assert_eq!(limits.backoff_start, Duration::from_secs(1));
        assert_eq!(limits.backoff_max, Duration::from_secs(30));
        assert_eq!(limits.answer_wait, Duration::from_secs(30));
        assert_eq!(limits.close_wait, Duration::from_secs(2));
        assert_eq!(limits.max_message_bytes, 16 * 1024 * 1024);
        assert_eq!(limits.download_hold_bytes, 1024 * 1024);
        assert_eq!(limits.max_transfers, 3);
        assert_eq!(limits.chunk_bytes, 32 * 1024);
    }

    #[test]
    fn a_test_can_shorten_one_limit_and_keep_the_rest() {
        let limits = Limits { idle_close: Duration::from_millis(50), ..Limits::default() };
        assert_eq!(limits.idle_close, Duration::from_millis(50));
        assert_eq!(limits.ping_after, PING_AFTER);
    }

    #[test]
    fn the_values_are_consistent() {
        const {
            assert!(PING_AFTER.as_nanos() < DROPPED_AFTER.as_nanos());
            assert!(BACKOFF_START.as_nanos() <= BACKOFF_MAX.as_nanos());
            assert!(CHUNK_BYTES < MAX_MESSAGE_BYTES);
            assert!(CHUNK_BYTES <= DOWNLOAD_HOLD_BYTES);
        }
    }
}
