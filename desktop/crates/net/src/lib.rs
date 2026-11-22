//! The transport bridge's native side: the dial to the daemon and the loopback proxy.
//!
//! * [`dial`]: a WebSocket to a daemon (TCP, TLS that trusts the operating system's store, the
//!   upgrade with the bearer subprotocol, a time limit) and a precise [`DialError`] when it cannot.
//! * [`proxy`]: from an open daemon socket, a single-use local URL the page opens its own
//!   `WebSocket` to; then messages pass unchanged and in order, bounded in what Rust holds, and a
//!   set of at most four such connections with a snapshot for `ui.inspect`.
//!
//! Every input here is hostile (the page's, the daemon's, and any other local program's): sizes are
//! capped before they are used, counters never wrap, a misbehaving peer ends in a closed connection
//! and a `lastError`, and nothing panics. Limits are named constants in [`limits`].
//!
//! Sockets live in this crate only, and are native only: on wasm32 this crate is empty and has no
//! dependency. The crate has no log: the proxy hands lines to a function the app gives it.
#![cfg(not(target_arch = "wasm32"))]

mod address;
pub mod dial;
pub mod error;
pub mod limits;
pub mod proxy;
mod stream;
mod tls;

#[cfg(test)]
mod testing;

pub use dial::{DIAL_LIMIT, Socket, check_address, dial};
pub use error::{DialError, ErrorCode, ProxyError, TlsReason};
pub use limits::Limits;
pub use proxy::{ConnectionSnapshot, EndCode, LastError, LocalUrl, Proxies, Reservation, Snapshot, State};
pub use stream::{KEEPALIVE_IDLE, KEEPALIVE_INTERVAL, KEEPALIVE_PROBES, Stream};
