//! The pure parts of the transport bridge: logic that needs no socket.
//!
//! * [`codec`]: a batch of WebSocket messages as `[kind: 1][length: 4, little-endian][payload]` items.
//! * [`window`]: the inbound window that stops reading the socket while the page is behind.
//! * [`order`]: the outbound buffer that puts frames the page sent out of order back in `seq` order.
//!
//! Every input here crossed the webview boundary, so it is hostile: lengths are bounded before they
//! are used, counters never wrap, and nothing panics. Limits are named constants in [`limits`].
//!
//! Sockets are native only: on wasm32 this crate is empty.
#![cfg(not(target_arch = "wasm32"))]

pub mod codec;
pub mod limits;
pub mod order;
pub mod window;

#[cfg(test)]
mod testing;

pub use codec::{CodecError, Item, Items, decode, encode_binary, encode_text};
pub use order::{OrderBuffer, OrderError};
pub use window::{InboundWindow, WindowError};
