//! Every limit of the bridge's pure parts, in one place.

use std::time::Duration;

/// Item kind of a UTF-8 text message in a frame batch.
pub const KIND_TEXT: u8 = 1;

/// Item kind of a binary message in a frame batch.
pub const KIND_BINARY: u8 = 2;

/// Bytes before an item's payload: one kind byte and a four-byte little-endian length.
pub const ITEM_HEADER_LEN: usize = 5;

/// The largest message either side may send: 128 MiB. A longer length field is refused before any
/// byte of the payload is looked at, so a hostile length cannot make the reader wait for or reserve
/// memory that never arrives.
pub const MAX_MESSAGE_BYTES: usize = 128 * 1024 * 1024;

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
