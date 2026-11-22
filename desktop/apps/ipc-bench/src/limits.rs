//! The channel candidates' limits (the frame codec, the inbound window and the order buffer).
//!
//! These moved here from the `net` crate with the modules that use them (P16, `swe/features/desktop-transport-bridge.md`):
//! the shipped bridge is the loopback proxy, which has none of them. The largest message, 128 MiB, is still
//! the `net` crate's (`pistudiodesktop_net::limits::MAX_MESSAGE_BYTES`).

use std::time::Duration;

/// Item kind of a UTF-8 text message in a frame batch.
pub const KIND_TEXT: u8 = 1;

/// Item kind of a binary message in a frame batch.
pub const KIND_BINARY: u8 = 2;

/// Bytes before an item's payload: one kind byte and a four-byte little-endian length.
pub const ITEM_HEADER_LEN: usize = 5;

/// Reading the socket stops while more than this many payload bytes sent to the page are
/// unacknowledged.
pub const WINDOW_HIGH_BYTES: u64 = 8 * 1024 * 1024;

/// Reading resumes once fewer than this many bytes are unacknowledged.
pub const WINDOW_LOW_BYTES: u64 = 4 * 1024 * 1024;

/// How many frames that arrived ahead of their turn may wait for the missing one.
pub const MAX_EARLY_FRAMES: usize = 64;

/// How long a gap in the send sequence may last before the connection fails with `send_order`.
pub const SEND_ORDER_GAP: Duration = Duration::from_secs(5);

/// The error code of every outbound-order failure.
pub const SEND_ORDER_CODE: &str = "send_order";
