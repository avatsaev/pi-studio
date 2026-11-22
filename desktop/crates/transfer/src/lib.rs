//! The transfer engine: uploads and saves over a connection of its own to the daemon.
//!
//! The engine speaks the daemon's protocol and schedules transfers, with no window and no Tauri,
//! so that it can be tested without either. Local files are reached through traits the app
//! implements. It opens its socket through [`pistudiodesktop_net::dial`] and through nothing else.
//!
//! * [`limits`]: every time, size and count the engine works within, named, and a [`Limits`] that a
//!   test can shorten.
//! * [`error`]: the one error type.
//! * [`wire`]: the frames the daemon and the engine exchange, built and read, with no socket.
//! * [`connection`]: the bulk connection over an open socket: the handshake, requests matched by id,
//!   liveness, and the frames of an upload and a download routed to whoever runs them.
//! * [`upload`]: one upload over an open connection: a source of bytes in, a confirmed file out, and
//!   every way it can end.
//! * [`download`]: one save over an open connection: a file on the daemon in, a sink out, from any
//!   offset, and every way it can end.
//! * [`engine`]: the queue: uploads and saves, three at a time, the connection opened on demand and
//!   closed when idle, progress events, cancel, and a snapshot of it all.
//! * [`held`]: the gauge of the bytes the engine holds in memory for transfers.
//! * `testing` (tests and the `testing` feature only): a daemon in the test's own process that answers,
//!   stores, serves and misbehaves on request.
//!
//! Every input here is hostile (what the daemon sends, what the page asks): sizes are capped
//! before they are used, and nothing panics.
//!
//! Native only: on wasm32 this crate is empty and has no dependency.
#![cfg(not(target_arch = "wasm32"))]

pub mod connection;
pub mod download;
pub mod engine;
pub mod error;
pub mod held;
pub mod limits;
pub mod upload;
pub mod wire;

#[cfg(any(test, feature = "testing"))]
pub mod testing;

pub use error::Error;
pub use limits::Limits;
