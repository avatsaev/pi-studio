//! Every limit of the proxy and of the dial, in one place.
//!
//! The constants are the shipped values. The proxy takes them as a [`Limits`], so that a test can
//! shorten a lifetime or lower a cap without touching what ships.

use std::time::Duration;

/// The largest message either leg may carry: 128 MiB. The WebSocket library enforces it while it
/// reads, from the frame's length field and before any byte of the payload is read, so a hostile
/// length cannot make Rust wait for or reserve memory that never arrives. A longer message closes
/// both legs with 1009.
pub const MAX_MESSAGE_BYTES: usize = 128 * 1024 * 1024;

/// Connections that exist at once: waiting for their page, or open.
pub const MAX_CONNECTIONS: usize = 4;

/// How long a connection waits for its page: the listener and the token live this long.
pub const PAGE_WAIT: Duration = Duration::from_secs(10);

/// Upgrades being read at once on one listener; more are dropped unanswered.
pub const MAX_UPGRADES: usize = 16;

/// How long one upgrade may take, from the TCP connection to the end of the request.
pub const UPGRADE_WAIT: Duration = Duration::from_secs(2);

/// After one side has started a close, how long the other has to finish it.
pub const CLOSE_WAIT: Duration = Duration::from_secs(2);

/// A direction writes what it holds to the other leg after this many payload bytes, even when more
/// has already arrived.
pub const FLUSH_BYTES: usize = 256 * 1024;

/// A direction writes after this many messages, even when more has already arrived.
pub const FLUSH_MESSAGES: usize = 64;

/// The token: 256 random bits.
pub const TOKEN_BYTES: usize = 32;

/// The limits of one set of connections. [`Limits::default`] is what ships.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Limits {
    /// A fifth connection is refused with `limit`.
    pub max_connections: usize,
    /// The largest message, on the page's leg and (checked when the socket is handed over) on the daemon's.
    pub max_message_bytes: usize,
    /// How long a connection waits for its page.
    pub page_wait: Duration,
    /// Upgrades in progress at once on one listener.
    pub max_upgrades: usize,
    /// How long one upgrade may take.
    pub upgrade_wait: Duration,
    /// How long a close handshake may take.
    pub close_wait: Duration,
    /// A write batch's payload bytes.
    pub flush_bytes: usize,
    /// A write batch's messages.
    pub flush_messages: usize,
}

impl Default for Limits {
    fn default() -> Self {
        Self {
            max_connections: MAX_CONNECTIONS,
            max_message_bytes: MAX_MESSAGE_BYTES,
            page_wait: PAGE_WAIT,
            max_upgrades: MAX_UPGRADES,
            upgrade_wait: UPGRADE_WAIT,
            close_wait: CLOSE_WAIT,
            flush_bytes: FLUSH_BYTES,
            flush_messages: FLUSH_MESSAGES,
        }
    }
}
