//! The transport bridge's native side: the dial to the daemon and the bridge's pure parts.
//!
//! * [`dial`]: a WebSocket to a daemon (TCP, TLS that trusts the operating system's store, the
//!   upgrade with the bearer subprotocol, a time limit) and a precise [`DialError`] when it cannot.
//! * [`codec`]: a batch of WebSocket messages as `[kind: 1][length: 4, little-endian][payload]` items.
//! * [`window`]: the inbound window that stops reading the socket while the page is behind.
//! * [`order`]: the outbound buffer that puts frames the page sent out of order back in `seq` order.
//!
//! Every input here crossed the webview boundary, so it is hostile: lengths are bounded before they
//! are used, counters never wrap, and nothing panics. Limits are named constants in [`limits`].
//!
//! Sockets live in this crate only, and are native only: on wasm32 this crate is empty and has no
//! dependency.
#![cfg(not(target_arch = "wasm32"))]

mod address;
pub mod codec;
pub mod dial;
pub mod error;
pub mod limits;
pub mod order;
mod stream;
mod tls;
pub mod window;

#[cfg(test)]
mod testing;

pub use codec::{CodecError, Item, Items, decode, encode_binary, encode_text};
pub use dial::{DIAL_LIMIT, Socket, dial};
pub use error::{DialError, ErrorCode, TlsReason};
pub use order::{OrderBuffer, OrderError};
pub use stream::{KEEPALIVE_IDLE, KEEPALIVE_INTERVAL, KEEPALIVE_PROBES, Stream};
pub use window::{InboundWindow, WindowError};
