//! A daemon in the test's own process, for the engine's tests.
//!
//! [`StandInDaemon`] is a WebSocket server on `127.0.0.1` (a port the system chooses). It answers
//! the handshake, `ping`, uploads and downloads as the real daemon does, from memory, and
//! misbehaves when a test scripts it to ([`Fault`]). It knows what the engine uses and no more:
//! no agents, no terminals, no disk.
//!
//! * The upgrade: with `Config::password` set, an upgrade that does not offer
//!   `pi-studio.bearer.<password>` is answered 401. The bearer subprotocol is echoed back.
//! * `hello` is answered with `status` (`server_info`) whose feature flags are `Config::features`;
//!   a first frame that is not a valid `hello` closes the socket 1008. `ping` is answered `pong`.
//! * An upload (`file_upload_request`, then `Begin`, `Chunk`s, `End`) is held in memory and put at
//!   its path only when `End` arrived; a client `Error`, a failure or a lost connection keeps
//!   nothing. `file_upload_complete` is sent when the request asked for `ack`.
//! * A download (`file_download_request`) is answered first, then streamed `Begin`, `Chunk`s, `End`,
//!   with `offset`, `length`, `ifUnchanged`, the refusals of the real daemon, and
//!   `file_download_cancel_request`, which is answered before the `Error` `cancelled` frame.
//!
//! The module exists only for this crate's tests and, through the `testing` feature, for another
//! crate's tests (an app lists the feature in its `[dev-dependencies]`). A release build has none
//! of it. Its own tests (`tests`) pin every frame it sends to the published fixtures.

mod connection;
mod download;
mod fault;
mod frames;
mod server;
mod state;

#[cfg(test)]
mod tests;

pub use fault::{After, Asked, Direction, Disorder, Fault, Request, StreamFault};
pub use server::{Config, Features, StandInDaemon};
pub use state::{FileInfo, UploadRecord};
