//! The client side of relay protocol 2 (`swe/architecture/relay-protocol.md`).
//!
//! The pure parts (the session id and the encrypted channel) have no socket and are tested against the
//! published relay fixtures; the connect state machine dials through `pistudiodesktop_net` and answers a
//! daemon socket the loopback proxy and the transfer engine take like any other.
#![cfg(not(target_arch = "wasm32"))]

pub mod channel;
pub mod connect;
pub mod error;
mod reason;
mod session_id;
pub mod socket;
#[cfg(any(test, feature = "testing"))]
pub mod testing;

pub use channel::{CHANNEL_VERSION, Channel, HELLO_LENGTH, KEY_LENGTH, KeyPair, MIN_BOX_LENGTH, Record, RecordKind, SALT_LENGTH};
pub use connect::{CLOSE_CHANNEL_ERROR, CLOSE_CHANNEL_ERROR_REASON, CONNECT_LIMIT, Connected, connect};
pub use error::ChannelError;
pub use reason::{RelayError, RelayReason};
pub use session_id::session_id;
pub use socket::{MAX_SEALED_BYTES, SEAL_OVERHEAD, plain_limit, sealed_limit};
